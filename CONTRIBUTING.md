# Contributing

1. 从 `main` 创建功能分支。
2. 修改后运行 `npm run check`。
3. 不要提交 `.env`、Webhook URL、API Key 或本地 SQLite 文件。
4. 新增新闻源时，实现 `NewsSource` 接口，并保证生成稳定的 `item.id`。
