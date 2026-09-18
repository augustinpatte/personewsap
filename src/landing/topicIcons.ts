import { Building2, Clapperboard, Cog, Cpu, Scale, Stethoscope, TrendingUp, Trophy, type LucideIcon } from "lucide-react";
import type { TopicId } from "./copy";

/** One quiet line icon per topic. Identity is carried by the name; the icon only helps scanning. */
export const TOPIC_ICONS: Record<TopicId, LucideIcon> = {
  business: Building2,
  finance: TrendingUp,
  tech_ai: Cpu,
  law: Scale,
  medicine: Stethoscope,
  engineering: Cog,
  sport_business: Trophy,
  culture_media: Clapperboard,
};
