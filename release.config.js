module.exports = {
  branches: ["main", "master"],
  plugins: [
    [
      "@semantic-release/commit-analyzer",
      {
        preset: "conventionalcommits",
      },
    ],
    "@semantic-release/release-notes-generator",
    "@semantic-release/changelog",
    [
      "@semantic-release/npm",
      {
        npmPublish: false,
      },
    ],
    "@semantic-release/git",
    [
      "@semantic-release/exec",
      {
        prepareCmd:
          "zip -qq -r logseq-plugin-deepseek-assistant-${nextRelease.version}.zip dist readme.md readme.zh-CN.md logo.svg LICENSE package.json",
      },
    ],
    [
      "@semantic-release/github",
      {
        assets: "logseq-plugin-deepseek-assistant-*.zip",
      },
    ],
  ],
};
