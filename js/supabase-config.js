/* Supabase connection settings for the contest tables (contest_results and
   nicknames).

   The key below is Supabase's *publishable* key: it is designed to ship in a
   public browser bundle and is safe to commit. It can only do what the tables'
   row-level security allows — insert a result and read results, and claim or
   read nicknames. It cannot update, delete, or touch any other table.

   Regenerate it any time from: Project Settings -> API -> publishable key.
*/
window.SUPABASE_CONFIG = {
  url: "https://lyzuxvcsjavxhlovgeeu.supabase.co",
  anonKey: "sb_publishable_1RuEXLVz36fvPQHs27DRQA_rmOFvNej"
};
