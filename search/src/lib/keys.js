// Every storage key starts with "cs" so this extension never reads or overwrites Crunchilist's data.
export const KEYS = {
  settings: "csSettings",
  session: "csAnilistSession",
  matches: "csMatches",
  checkpoints: "csCheckpoints",
  importLog: "csImportLog",
  notices: "csNotices",
  feeds: "csFeeds",
};
