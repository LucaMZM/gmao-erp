import { env } from "cloudflare:workers";
import {
  resolveApplicationMode,
  type ApplicationMode,
} from "@/lib/domain/application-mode";

export function applicationMode(): ApplicationMode {
  return resolveApplicationMode(env.MAZMI_APP_MODE);
}
