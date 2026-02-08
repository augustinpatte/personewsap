import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone

import boto3
from supabase import create_client
from pathlib import Path
import base64

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None


def require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value.strip().strip('"').strip("'")


def decode_jwt_meta(token: str) -> dict:
    try:
        parts = token.split(".")
        if len(parts) < 2:
            return {}
        payload = parts[1] + "=" * (-len(parts[1]) % 4)
        decoded = base64.urlsafe_b64decode(payload.encode("utf-8"))
        data = json.loads(decoded.decode("utf-8"))
        return {
            "ref": data.get("ref"),
            "role": data.get("role"),
            "exp": data.get("exp"),
        }
    except Exception:
        return {}


from typing import Optional, Dict, Any


def normalize_article(article: dict, subjects_map: Dict[str, dict]) -> Optional[Dict[str, Any]]:
    language = (article.get("language") or article.get("lang") or "").lower().strip()
    subject_id = article.get("subject_id") or article.get("subject") or article.get("topic")
    topic = normalize_topic_key(str(subject_id)) if subject_id else ""
    if subject_id in subjects_map:
        topic = normalize_topic_key(subjects_map[subject_id].get(language) or subjects_map[subject_id].get("en") or subject_id)

    title = article.get("title") or article.get("headline") or ""
    content = article.get("content") or article.get("body") or article.get("text") or ""
    sources = article.get("sources") or article.get("links") or article.get("urls") or []
    if isinstance(sources, str):
        sources = [sources]

    if not language or not topic or not title or not content:
        return None

    return {
        "language": language,
        "topic": topic,
        "title": title,
        "content": content,
        "sources": sources,
    }


def load_articles(path: str) -> list[dict]:
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        subjects = data.get("subjects") or []
        subjects_map = {item.get("id"): item for item in subjects if isinstance(item, dict)}
        items = data.get("articles") or data.get("items") or []
        if not isinstance(items, list):
            raise ValueError("Expected 'articles' to be a list.")
        normalized = []
        for item in items:
            if not isinstance(item, dict):
                continue
            normalized_item = normalize_article(item, subjects_map)
            if normalized_item:
                normalized.append(normalized_item)
        if not normalized:
            raise ValueError("No valid articles found after normalization.")
        return normalized
    raise ValueError("Expected a JSON array or object containing articles.")


def normalize_topic_key(value: str) -> str:
    return value.strip().lower().replace(" ", "_")


def group_articles(articles: list[dict]) -> dict[tuple[str, str], list[dict]]:
    grouped: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for article in articles:
        language = article.get("language", "").lower().strip()
        topic = normalize_topic_key(article.get("topic", ""))
        if not language or not topic:
            continue
        grouped[(language, topic)].append(article)
    return grouped


def fetch_subscribers(supabase_url: str, supabase_key: str) -> list[dict]:
    client = create_client(supabase_url, supabase_key)

    users = (
        client.table("users")
        .select("id, email, language, email_opt_in")
        .eq("email_opt_in", True)
        .execute()
        .data
    )

    if not users:
        return []

    user_ids = [user["id"] for user in users]
    topics = (
        client.table("user_topics")
        .select("user_id, topic_name, articles_count")
        .in_("user_id", user_ids)
        .execute()
        .data
    )

    topics_by_user: dict[str, list[dict]] = defaultdict(list)
    for topic in topics or []:
        topics_by_user[topic["user_id"]].append(topic)

    for user in users:
        user["topics"] = topics_by_user.get(user["id"], [])

    return users


def build_email_body(language: str, selected: list[dict]) -> str:
    header = "Bonjour," if language == "fr" else "Hello,"
    intro = (
        "Voici votre newsletter du jour." if language == "fr" else "Here is your newsletter for today."
    )
    lines = [header, "", intro, ""]
    for article in selected:
        lines.append(f"{article['title']}")
        lines.append(article["content"])
        sources = article.get("sources", [])
        if sources:
            lines.append("Sources:")
            for source in sources:
                lines.append(f"- {source}")
        lines.append("")
    lines.append("Merci !" if language == "fr" else "Thanks!")
    return "\n".join(lines)


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    with path.open("r", encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            os.environ[key] = value


def dispatch(articles_path: str, dry_run: bool = False) -> None:
    env_path = Path(__file__).with_name(".env.python")
    load_env_file(env_path)
    supabase_url = require_env("SUPABASE_URL")
    supabase_key = require_env("SUPABASE_SERVICE_ROLE_KEY")
    ses_region = require_env("SES_REGION")
    ses_sender = require_env("SES_SENDER_EMAIL")

    if dry_run:
        meta = decode_jwt_meta(supabase_key)
        print(f"[DEBUG] SUPABASE_URL={supabase_url}")
        print(f"[DEBUG] KEY_REF={meta.get('ref')} ROLE={meta.get('role')}")
        print(f"[DEBUG] KEY_LEN={len(supabase_key)} DOTS={supabase_key.count('.')}")
        print(f"[DEBUG] KEY_HEAD={supabase_key[:12]} KEY_TAIL={supabase_key[-12:]}")

    articles = load_articles(articles_path)
    grouped = group_articles(articles)
    subscribers = fetch_subscribers(supabase_url, supabase_key)

    if not subscribers:
        print("No subscribers found.")
        return

    ses = boto3.client("ses", region_name=ses_region)
    sent = 0

    for user in subscribers:
        language = user.get("language", "en")
        selections: list[dict] = []
        for topic in user.get("topics", []):
            key = (language, normalize_topic_key(topic["topic_name"]))
            available = grouped.get(key, [])
            count = int(topic.get("articles_count", 1))
            selections.extend(available[:count])

        if not selections:
            continue

        subject = (
            f"PersoNewsAP · {datetime.now(timezone.utc).strftime('%Y-%m-%d')}"
        )
        body = build_email_body(language, selections)

        if dry_run:
            print(f"[DRY RUN] Would send to {user['email']} with {len(selections)} articles.")
            continue

        ses.send_email(
            Source=ses_sender,
            Destination={"ToAddresses": [user["email"]]},
            Message={
                "Subject": {"Data": subject, "Charset": "UTF-8"},
                "Body": {"Text": {"Data": body, "Charset": "UTF-8"}},
            },
        )
        sent += 1

    print(f"Sent {sent} emails.")


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python dispatchnewsletter.py <articles.json> [--dry-run]")
        sys.exit(1)

    articles_path = sys.argv[1]
    dry_run = "--dry-run" in sys.argv
    dispatch(articles_path, dry_run=dry_run)


if __name__ == "__main__":
    main()
