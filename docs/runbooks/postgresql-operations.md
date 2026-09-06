# PostgreSQL 运维说明

## 当前远端状态

- PostgreSQL 15.19，数据库端口 `33989`。
- 应用账号的公网规则使用 `hostssl`、`scram-sha-256`，并限制为已登记的单一客户端 IPv4 地址。
- TLS 最低版本为 `TLSv1.2`，当前 Node 客户端实测协商为 TLS 1.3。
- 服务端证书使用独立 CA 和 IP SAN；私钥只保留在服务器 `/etc/postgresql/15/main/tls/`。
- 主机未启用 `ufw` 或 `iptables`，`nftables` 服务当前未启用且规则集为空。阿里云安全组已通过实际 TCP 连通性验证允许 `33989/TCP`，但控制台规则明细需要阿里云控制台或 API 凭据才能读取。
- 阿里云 CloudMonitor agent 已安装并启用；项目自身另有 systemd 健康检查作为数据库级探针。

## 自动备份

备份文件位于服务器 `/var/backups/lijing/postgresql/`，每天约 03:15 执行，带 15 分钟随机延迟，保留 14 天。脚本使用 PostgreSQL custom format，写入临时文件并通过 `pg_restore --list` 校验后再原子改名；备份文件权限为 `600`，目录权限为 `700`。

安装或恢复时，将本目录下的脚本复制到 `/usr/local/sbin/`，将 `infra/systemd/` 下的四个 unit 文件复制到 `/etc/systemd/system/`，然后执行：

```bash
install -d -o postgres -g postgres -m 700 /var/backups/lijing/postgresql
chmod 750 /usr/local/sbin/lijing-postgres-backup /usr/local/sbin/lijing-postgres-healthcheck
systemctl daemon-reload
systemctl enable --now lijing-postgres-backup.timer lijing-postgres-health.timer
```

查看最近一次结果：

```bash
systemctl status lijing-postgres-backup.service lijing-postgres-health.service --no-pager
journalctl -u lijing-postgres-backup.service -u lijing-postgres-health.service -n 50 --no-pager
```

当前配置是服务器本地逻辑备份，不等于异地灾备；尚未配置对象存储或跨地域副本。

## TLS 客户端配置

Node 服务使用 `SUPABASE_DB_SSL=true` 和 `SUPABASE_DB_SSL_CA`，CA 文件是仓库中的公开证书。数据库连接串、密码和服务器私钥不得写入仓库、前端变量或日志。

证书轮换后，需要替换服务器端证书并同步公开 CA，然后重启 PostgreSQL、重启应用并重新执行真实 TLS 查询。证书到期时间应通过以下命令定期检查：

```bash
openssl x509 -in /etc/postgresql/15/main/tls/server.crt -noout -subject -issuer -dates -ext subjectAltName
```
