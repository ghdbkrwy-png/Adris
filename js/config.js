window.APP_CONFIG = {
  APP_NAME: "ادرس معي",
  APP_TAGLINE: "يقرأ مصادرك ويشرحها لك — حتى بصوت بودكاست",
  SUPABASE_URL: "https://dblsgkfggjujgmnnpdux.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRibHNna2ZnZ2p1amdtbm5wZHV4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4NzM2NTksImV4cCI6MjEwNDQ0OTY1OX0.gobgwttN5bMURVySd08WGZA5zIk40j-oZ_wODt5WOvs",
  REPOSITORY_BASE: "/Adris/"
};

window.SUPABASE_FUNCTION = function(name) {
  return `${APP_CONFIG.SUPABASE_URL}/functions/v1/${name}`;
};
