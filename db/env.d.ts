declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    FILES: R2Bucket;
    MAZMI_TEST_NOW?: string;
  }
}
