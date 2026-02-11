# -*- coding: utf-8 -*-
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone

from supabase import create_client
from pathlib import Path
import base64
import urllib.request
import urllib.error
import subprocess

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
import re
import unicodedata


def parse_article_number(value) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, int):
        return value
    try:
        text = str(value)
    except Exception:
        return None
    match = re.search(r"\d+", text)
    if not match:
        return None
    try:
        return int(match.group(0))
    except Exception:
        return None


def normalize_article(article: dict, subjects_map: Dict[str, dict]) -> Optional[Dict[str, Any]]:
    language = (article.get("language") or article.get("lang") or "").lower().strip()
    subject_id = article.get("subject_id") or article.get("subject") or article.get("topic")
    topic = normalize_topic_key(str(subject_id)) if subject_id else ""
    if subject_id in subjects_map:
        label = subjects_map[subject_id].get(language) or subjects_map[subject_id].get("en") or subject_id
        mapped = label_to_topic(str(label))
        topic = mapped or normalize_topic_key(str(label))

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
        "article_number": parse_article_number(
            article.get("article_number") or article.get("number") or article.get("index")
        ),
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


def slugify_label(value: str) -> str:
    text = unicodedata.normalize("NFKD", value)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r"[^a-zA-Z0-9]+", "", text).lower()
    return text


LABEL_TO_TOPIC = {
    "sport": "sport",
    "sports": "sport",
    "international": "international",
    "financeeconomie": "finance",
    "financeeconomy": "finance",
    "marcheactions": "stocks",
    "stockmarket": "stocks",
    "industrieautomobile": "automotive",
    "automotiveindustry": "automotive",
    "industriepharmaceutique": "pharma",
    "pharmaceuticalindustry": "pharma",
    "intelligenceartificielle": "ai",
    "artificialintelligence": "ai",
    "culture": "culture",
}


def label_to_topic(label: str):
    key = slugify_label(label)
    return LABEL_TO_TOPIC.get(key)


TOPIC_ALIASES = {
    "international": "international",
    "geopolitique": "international",
    "sport": "sport",
    "sports": "sport",
    "finance": "finance",
    "marches_finance": "finance",
    "marche_actions": "stocks",
    "stock_market": "stocks",
    "stocks": "stocks",
    "automotive": "automotive",
    "industrie_automobile": "automotive",
    "pharma": "pharma",
    "sante": "pharma",
    "industrie_pharmaceutique": "pharma",
    "ai": "ai",
    "technologie": "ai",
    "culture": "culture",
}


def map_topic(topic_key: str) -> str:
    key = normalize_topic_key(topic_key)
    return TOPIC_ALIASES.get(key, key)


def group_articles(articles: list[dict]) -> dict[tuple[str, str], list[dict]]:
    grouped: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for article in articles:
        language = article.get("language", "").lower().strip()
        topic = normalize_topic_key(article.get("topic", ""))
        if not language or not topic:
            continue
        grouped[(language, map_topic(topic))].append(article)
    for key in grouped:
        grouped[key].sort(key=lambda a: a.get("article_number") or 999)
    return grouped


TOPIC_LABELS = {
    "fr": {
        "sport": "Sport",
        "international": "International",
        "geopolitique": "International",
        "finance": "Finance / Économie",
        "stocks": "Marché actions",
        "marches_finance": "Finance / Économie",
        "automotive": "Industrie automobile",
        "pharma": "Industrie pharmaceutique",
        "sante": "Industrie pharmaceutique",
        "ai": "Intelligence artificielle",
        "technologie": "Intelligence artificielle",
        "culture": "Culture",
    },
    "en": {
        "sport": "Sports",
        "international": "International",
        "geopolitique": "International",
        "finance": "Finance / Economy",
        "stocks": "Stock Market",
        "marches_finance": "Finance / Economy",
        "automotive": "Automotive industry",
        "pharma": "Pharmaceutical industry",
        "sante": "Pharmaceutical industry",
        "ai": "Artificial Intelligence",
        "technologie": "Artificial Intelligence",
        "culture": "Culture",
    },
}


def display_topic_label(topic_key: str, language: str) -> str:
    lang = "fr" if language == "fr" else "en"
    key = normalize_topic_key(topic_key)
    return TOPIC_LABELS.get(lang, {}).get(key, topic_key)


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


def build_email_html(language: str, selected: list[dict]) -> str:
    brand = "PersoNewsAP"
    brand_blue = "#054EAB"
    menu_title = "Menu du jour" if language == "fr" else "Today's menu"
    thanks = "Merci pour votre lecture! Bonne journée!" if language == "fr" else "Thanks for reading! Have a great day!"
    unsubscribe_label = "Se désinscrire" if language == "fr" else "Unsubscribe"
    unsubscribe_url = "https://personewsap.com/account"
    logo_url = "https://personewsap.com/logo-white.png"

    grouped = defaultdict(list)
    for article in selected:
        grouped[article.get("topic", "autre")].append(article)

    def escape(text: str) -> str:
        return (
            text.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
        )

    def render_bold(text: str) -> str:
        escaped = escape(text)
        return re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", escaped)

    menu_lines = []
    for topic, items in grouped.items():
        label = display_topic_label(topic, language)
        menu_lines.append(f"<div style='margin-bottom:6px;'><strong>{escape(label)}</strong></div>")
        for item in items:
            menu_lines.append(f"<div style='margin-left:12px;'>&bull; {escape(item['title'])}</div>")

    article_blocks = []
    for idx, article in enumerate(selected, start=1):
        sources = article.get("sources", [])
        source_lines = []
        for source in sources:
            url = escape(source)
            source_lines.append(f"<div><a href='{url}' style='color:#1f3e7a;'>{url}</a></div>")
        sources_html = "".join(source_lines) if source_lines else ""
        content_html = "<br/>".join(render_bold(article["content"]).split("\n"))
        article_blocks.append(
            f"""
            <div style="margin-bottom:24px;">
              <div style="font-weight:700;margin-bottom:6px;">Article {idx}: {escape(article['title'])}</div>
              <div style="line-height:1.6;">{content_html}</div>
              <div style="margin-top:8px;font-size:12px;color:#1f3e7a;">Sources :</div>
              <div style="font-size:12px;line-height:1.5;">{sources_html}</div>
            </div>
            """
        )

    menu_html = "".join(menu_lines)
    articles_html = "".join(article_blocks)

    return f"""
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#0b1a3a;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:{brand_blue};padding:24px 0;font-family:Helvetica,Arial,sans-serif;">
    <tr>
      <td align="center">
        <table align="center" width="520" cellpadding="0" cellspacing="0" style="width:520px;max-width:520px;margin:0 auto 20px;">
          <tr>
            <td align="center">
              <table cellpadding="0" cellspacing="0" style="margin:0 auto;">
                <tr>
                  <td style="padding-right:12px;">
                    <img src="{logo_url}" alt="{brand}" width="48" height="48" style="display:block;" />
                  </td>
                  <td style="font-size:28px;font-weight:800;color:#ffffff;letter-spacing:0.2px;font-family:Georgia,'Times New Roman',serif;">
                    {brand}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
        <table align="center" width="520" cellpadding="0" cellspacing="0" style="width:520px;max-width:520px;background:#ffffff;border-radius:4px;padding:24px;margin:0 auto;">
          <tr>
            <td>
              <div style="text-align:center;font-weight:700;margin-bottom:12px;font-family:Georgia,'Times New Roman',serif;font-size:16px;">{menu_title}</div>
              <div style="text-align:left;font-size:14px;line-height:1.5;">{menu_html}</div>
              <div style="border-bottom:2px solid {brand_blue};margin:24px 0;"></div>
              {articles_html}
              <div style="border-bottom:2px solid {brand_blue};margin:24px 0;"></div>
              <div style="text-align:center;font-weight:700;font-family:Georgia,'Times New Roman',serif;">{thanks}</div>
              <div style="text-align:center;margin-top:12px;font-size:12px;">
                <a href="{unsubscribe_url}" style="color:#1f3e7a;text-decoration:underline;">{unsubscribe_label}</a>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
"""


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
            if key not in os.environ or not os.environ.get(key):
                os.environ[key] = value


def resend_send(resend_api_key: str, resend_sender: str, to_email: str, subject: str, html: str, text: str) -> bool:
    payload = {
        "from": resend_sender,
        "to": [to_email],
        "subject": subject,
        "html": html,
        "text": text,
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        "https://api.resend.com/emails",
        data=data,
        headers={
            "Authorization": f"Bearer {resend_api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "PersoNewsAP-Dispatcher/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            resp.read()
        return True
    except urllib.error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")
        # Some environments hit Cloudflare 1010 with urllib; fallback to PowerShell call.
        if exc.code == 403 and "1010" in details:
            if resend_send_powershell(resend_api_key, payload):
                return True
        print(f"Resend error for {to_email}: {exc.code} {details}")
        return False
    except Exception as exc:
        print(f"Resend error for {to_email}: {exc}")
        return False


def resend_send_powershell(resend_api_key: str, payload: dict) -> bool:
    command = (
        "$headers = @{ Authorization = \"Bearer $env:RESEND_API_KEY\"; \"Content-Type\" = \"application/json\" }; "
        "$body = $env:RESEND_PAYLOAD_JSON; "
        "Invoke-RestMethod -Method Post -Uri \"https://api.resend.com/emails\" -Headers $headers -Body $body | Out-Null"
    )
    env = os.environ.copy()
    env["RESEND_API_KEY"] = resend_api_key
    env["RESEND_PAYLOAD_JSON"] = json.dumps(payload, ensure_ascii=False)
    try:
        result = subprocess.run(
            ["powershell", "-NoProfile", "-Command", command],
            capture_output=True,
            text=True,
            env=env,
            timeout=30,
        )
        if result.returncode == 0:
            return True
        stderr = (result.stderr or "").strip()
        if stderr:
            print(f"Resend PowerShell fallback error: {stderr}")
        return False
    except Exception:
        return False


def dispatch(
    articles_path: str,
    dry_run: bool = False,
    only_email: Optional[str] = None,
    from_override: Optional[str] = None,
    api_key_override: Optional[str] = None,
    resend_ping: bool = False,
) -> None:
    env_path = Path(__file__).with_name(".env.python")
    load_env_file(env_path)
    supabase_url = require_env("SUPABASE_URL")
    supabase_key = require_env("SUPABASE_SERVICE_ROLE_KEY")
    resend_api_key = api_key_override or require_env("RESEND_API_KEY")
    resend_sender = from_override or require_env("RESEND_FROM")
    resend_debug = os.getenv("RESEND_DEBUG", "").lower() in ("1", "true", "yes")

    if dry_run:
        meta = decode_jwt_meta(supabase_key)
        print(f"[DEBUG] SUPABASE_URL={supabase_url}")
        print(f"[DEBUG] KEY_REF={meta.get('ref')} ROLE={meta.get('role')}")
        print(f"[DEBUG] KEY_LEN={len(supabase_key)} DOTS={supabase_key.count('.')}")
        print(f"[DEBUG] KEY_HEAD={supabase_key[:12]} KEY_TAIL={supabase_key[-12:]}")
    if resend_debug:
        key_len = len(resend_api_key)
        key_head = resend_api_key[:6]
        key_tail = resend_api_key[-4:] if key_len >= 4 else resend_api_key
        print(f"[DEBUG] RESEND_FROM={resend_sender}")
        print(f"[DEBUG] RESEND_KEY_LEN={key_len} RESEND_KEY_HEAD={key_head} RESEND_KEY_TAIL={key_tail}")

    articles = load_articles(articles_path)
    grouped = group_articles(articles)
    subscribers = fetch_subscribers(supabase_url, supabase_key)

    if not subscribers:
        print("No subscribers found.")
        return

    sent = 0
    preview_dir = Path(__file__).with_name("previews")
    if dry_run:
        preview_dir.mkdir(exist_ok=True)
        for old_file in preview_dir.glob("*.html"):
            old_file.unlink()

    if resend_ping:
        ok = resend_send(
            resend_api_key,
            resend_sender,
            only_email or "augustin.patte@gmail.com",
            "Resend ping",
            "<p>Ping</p>",
            "Ping",
        )
        print("Resend ping ok." if ok else "Resend ping failed.")
        return

    for user in subscribers:
        if only_email and user.get("email", "").lower() != only_email.lower():
            continue
        language = user.get("language", "en")
        selections: list[dict] = []
        for topic in user.get("topics", []):
            raw_key = normalize_topic_key(topic["topic_name"])
            mapped_key = map_topic(raw_key)
            key = (language, mapped_key)
            available = grouped.get(key, [])
            count = int(topic.get("articles_count", 1))
            # Prefer articles numbered 1..count when provided
            numbered = [a for a in available if a.get("article_number") is not None]
            if numbered:
                picked = [a for a in numbered if a.get("article_number") <= count]
                if len(picked) < count:
                    remaining = [a for a in available if a not in picked]
                    picked.extend(remaining[: max(0, count - len(picked))])
                selections.extend(picked[:count])
            else:
                selections.extend(available[:count])

        if not selections:
            continue

        subject = (
            f"PersoNewsAP · {datetime.now(timezone.utc).strftime('%Y-%m-%d')}"
        )
        body = build_email_body(language, selections)
        html = build_email_html(language, selections)

        if dry_run:
            safe_email = user["email"].replace("@", "_at_").replace(".", "_")
            preview_path = preview_dir / f"{safe_email}.html"
            preview_path.write_text(html, encoding="utf-8")
            print(f"[DRY RUN] Would send to {user['email']} with {len(selections)} articles. Preview: {preview_path}")
            continue

        if not resend_send(resend_api_key, resend_sender, user["email"], subject, html, body):
            continue
        sent += 1

    print(f"Sent {sent} emails.")


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python dispatchnewsletter.py <articles.json> [--dry-run] [--only email@example.com] [--from sender@example.com] [--api-key re_...] [--resend-ping]")
        sys.exit(1)

    articles_path = sys.argv[1]
    dry_run = "--dry-run" in sys.argv
    only_email = None
    from_override = None
    api_key_override = None
    if "--only" in sys.argv:
        idx = sys.argv.index("--only")
        if idx + 1 < len(sys.argv):
            only_email = sys.argv[idx + 1]
    if "--from" in sys.argv:
        idx = sys.argv.index("--from")
        if idx + 1 < len(sys.argv):
            from_override = sys.argv[idx + 1]
    if "--api-key" in sys.argv:
        idx = sys.argv.index("--api-key")
        if idx + 1 < len(sys.argv):
            api_key_override = sys.argv[idx + 1]
    resend_ping = "--resend-ping" in sys.argv
    dispatch(
        articles_path,
        dry_run=dry_run,
        only_email=only_email,
        from_override=from_override,
        api_key_override=api_key_override,
        resend_ping=resend_ping,
    )


if __name__ == "__main__":
    main()


