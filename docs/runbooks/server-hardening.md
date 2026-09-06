# 服务器安全加固

## 当前生效策略

- SSH 只保留 `23/TCP`；`22/TCP` 由主机防火墙丢弃。
- SSH 仅允许 `admin` 用户使用公钥认证；root SSH、密码认证和 keyboard-interactive 认证均关闭。
- SSH 最大认证尝试为 3 次，登录宽限期为 20 秒，启用连接保活，关闭 X11、Agent、TCP 转发和用户环境注入。
- `admin` 使用独立 Ed25519 密钥并通过受限的 `sudo` 管理；私钥只保存在管理工作站，不进入仓库。
- fail2ban 使用 systemd journal 和 nftables，5 次失败 / 10 分钟封禁 1 小时，递增最长 1 天。
- 当前管理出口 `117.168.36.209/32` 在 fail2ban 白名单中；出口地址变化后必须同步更新白名单和数据库访问规则。
- nftables 入站默认丢弃，只允许 SSH 23/TCP，以及来自 `117.168.36.209/32` 的 PostgreSQL 33989/TCP。

## 应急验证

```bash
sshd -t
sshd -T | grep -E '^(permitrootlogin|passwordauthentication|authenticationmethods|allowusers|maxauthtries) '
systemctl is-active ssh.service fail2ban.service nftables.service
fail2ban-client status sshd
nft list ruleset
```

应用加固前必须先验证 admin 公钥登录。不要在没有备用公钥或云控制台救援通道的情况下关闭密码登录。

## 仍需关注

- 阿里云安全组控制台规则明细没有通过 API 读取；当前 `23/TCP` 和受限的 `33989/TCP` 已从外部实际验证可达。
- CloudMonitor agent 已运行，但云控制台告警阈值和通知联系人不在本次主机配置中。
- 管理工作站上的私钥必须使用 Windows 账户 ACL 保护，并纳入本机备份和轮换流程。
