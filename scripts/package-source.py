"""Create a local, redacted source handoff without touching wallet/browser data."""
from pathlib import Path
import argparse
import hashlib
import json
import re
import struct
import zipfile

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--sdk-dir', type=Path, default=root.parent / 'plabs-wallet-sdk')
args = parser.parse_args()
sdk = args.sdk_dir.resolve()
if not (sdk / 'package.json').is_file():
    raise SystemExit('Standalone SDK source not found; supply --sdk-dir.')
version = json.loads((root / 'package.json').read_text())['version']
skip_dirs = {'node_modules', 'dist', '.git', 'artifacts', 'coverage', '.cache', '.vite', '.idea', '.vscode', '__pycache__', '.codex'}
secret_files = {'.npmrc', '.yarnrc', '.yarnrc.yml', '.pypirc', '.netrc', '.DS_Store'}
secret_pattern = re.compile(rb'(?:npm_[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)')
local_path = re.compile(r"/(?:Users|home)/[A-Za-z0-9_.-]+/[^\s\"'<>`]+|/var/folders/[A-Za-z0-9_-]+/[^\s\"'<>`]+")
url_password = re.compile(rb'https?://[^\s/\"\']+:[^\s/@\"\']+@')
entries = {}
changes = []
excluded = []

def strip_png_metadata(data):
    if not data.startswith(b'\x89PNG\r\n\x1a\n'):
        return data
    kept = [data[:8]]; position = 8
    while position < len(data):
        length = struct.unpack('>I', data[position:position + 4])[0]
        kind = data[position + 4:position + 8]
        end = position + length + 12
        if end > len(data):
            raise ValueError('Invalid PNG chunk')
        if kind not in {b'tEXt', b'zTXt', b'iTXt', b'eXIf', b'tIME'}:
            kept.append(data[position:end])
        position = end
    return b''.join(kept)

for project, directory in [('extension', root), ('sdk', sdk)]:
    for path in sorted(directory.rglob('*')):
        relative = path.relative_to(directory)
        if path.is_symlink():
            continue
        if not path.is_file():
            continue
        if any(part in skip_dirs for part in relative.parts):
            continue
        if 'releases' in relative.parts and relative.parts[:2] != ('releases', 'store-assets'):
            continue
        if path.name in secret_files or path.name.startswith('.env') or path.suffix in {'.tsbuildinfo', '.log', '.zip', '.tgz', '.pem', '.key', '.p12', '.pfx'}:
            excluded.append(f'{project}/{relative.as_posix()}')
            continue
        name = f'{project}/{relative.as_posix()}'
        data = path.read_bytes()
        original = data
        try:
            text = data.decode('utf-8')
        except UnicodeDecodeError:
            text = None
        if text is not None:
            # Historical browser scripts may retain a developer-specific binary path.
            if relative.as_posix() in {'scripts/smoke.mjs', 'scripts/ui-smoke.mjs'}:
                text = re.sub(r"process\.env\.CHROME_BIN\s*\?\?\s*'[^']*'", 'process.env.CHROME_BIN', text)
                # Replace only the mocked account, not protocol contract addresses.
                text = re.sub(r"(const address\s*=\s*)'0x[0-9a-fA-F]{40}'", r"\1'0x1111111111111111111111111111111111111111'", text)
            text = local_path.sub('/REDACTED_LOCAL_PATH', text)
            if project == 'sdk' and relative.as_posix() == 'PUBLISHING.md':
                text = text.replace('npm install /REDACTED_LOCAL_PATH', 'npm install ./plabs-wallet-sdk-0.1.0.tgz')
            data = text.encode('utf-8')
        if path.suffix.lower() == '.png':
            data = strip_png_metadata(data)
        # Fail closed instead of automatically corrupting a source literal or vendored binary.
        if secret_pattern.search(data) or url_password.search(data):
            raise SystemExit(f'Potential credential needs manual review in {name}; nothing published.')
        if data != original:
            changes.append(name)
        entries[name] = data

entries['README-SOURCE.md'] = f'''# PLabs source handoff — {version}

- `extension/`: complete maintained extension source, configuration, lockfile, SDK workspace source, documentation, scripts and packaged runtime assets.
- `sdk/`: standalone npm source project for `plabs-wallet-sdk@0.1.0`. This differs in package name from the extension's internal `@plabs-wallet/sdk` workspace snapshot.
- `REDACTION.md`: exclusions and remaining public information.
- `SOURCE-FILES.sha256`: checksums of the redacted files in this archive.

Build the extension from `extension/` with `pnpm install --frozen-lockfile` and `pnpm run build`. Package using `python3 scripts/package-store.py`.
Build the standalone SDK from `sdk/` with `npm ci` and `npm run build`.
Browser scripts require an explicit `CHROME_BIN` appropriate for your machine and include historical expectations; their inclusion does not mean they have been run or are current regression coverage.
To repeat this source packaging layout, run `python3 scripts/package-source.py --sdk-dir ../sdk` from `extension/`.

No package is published or uploaded by this handoff. No automated tests or real signatures/transactions were run for this packaging task.
Vendored WASM, proof circuits and other third-party assets remain included as required by the build; their upstream source/redistribution-license and independent-audit gaps are described in the security documents. This is not a complete source rebuild of those vendored binaries.
Historical source/build hashes in `docs/release-prep/evidence/` describe the pre-redaction audit snapshots. Use the new `SOURCE-FILES.sha256` for this archive instead.
'''.encode()
entries['REDACTION.md'] = ('''# 脱敏打包说明

仅处理打包副本，没有修改真实钱包存储、密钥、配置或账户。

## 已排除

node_modules、dist、artifacts（真实/历史截图及设计过程快照）、缓存、Git/编辑器元数据、日志、编译增量文件、环境文件、发布凭据文件及历史 ZIP/TGZ 发布包。releases 中只保留商店图标/宣传图素材及说明。未收集浏览器配置、IndexedDB、钱包 Vault 导出或操作历史数据库。

## 已替换

测试脚本本机 Chrome 可执行文件路径改为 CHROME_BIN 环境变量；UI 脚本的账户地址改为通用示例地址；文档本机绝对路径清除；PNG 若含文本/EXIF/时间元数据则剥离。实际修改文件见后表。

## 有意保留

协议合约/池地址、公共 RPC 与服务域名、品牌图标、许可证作者署名与公开联系方式、公开的测试助记词/重复字节私钥/测试密码 fixture。它们不是用户真实恢复材料，不能用于存放资产。私钥或密码变量名及加密逻辑本身属于源码，不应删除。

内部安全报告和准备文档包含架构/风险信息，为完整代码审查保留；本次仅生成本地归档，不等于建议将内部报告全部公开上线。

## 检查范围

对候选文件检查常见 npm/GitHub/API/AWS 凭据格式、私钥 PEM、URL 内嵌认证及本机标识；对预编译资源检查可识别的嵌入文本。没有发现需携带到归档的真实凭据。模式扫描不能保证识别一切未知凭据格式，也不证明捆绑二进制的安全性。

未运行单元、UI 或真实扩展回归。新清单记录的是脱敏后文件，不沿用原审查版本的哈希作为本包校验值。

## 本次修改的文件

''' + '\n'.join(f'- `{name}`' for name in changes) + '\n').encode()
entries['REDACTION-REPORT.json'] = json.dumps({'version': version, 'redacted_files': changes,
    'excluded_sensitive_or_generated_files': excluded,
    'credential_pattern_matches_remaining': 0,
    'notes': 'Known public test fixtures and third-party license attribution retained. No runtime tests performed.'}, indent=2).encode() + b'\n'
entries['SOURCE-FILES.sha256'] = ''.join(f'{hashlib.sha256(data).hexdigest()}  {name}\n' for name, data in sorted(entries.items())).encode()

release = root / 'releases' / f'plabs-wallet-source-redacted-{version}.zip'
release.parent.mkdir(parents=True, exist_ok=True)
staged = release.with_suffix('.zip.tmp')
try:
    with zipfile.ZipFile(staged, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in sorted(entries.items()):
            info = zipfile.ZipInfo(f'plabs-wallet-source-{version}/{name}', (2020, 1, 1, 0, 0, 0))
            info.create_system = 3; info.external_attr = 0o100644 << 16
            archive.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    staged.replace(release)
finally:
    staged.unlink(missing_ok=True)
checksum = hashlib.sha256(release.read_bytes()).hexdigest()
release.with_suffix('.zip.sha256').write_text(f'{checksum}  {release.name}\n')
print(json.dumps({'filename': release.name, 'files': len(entries), 'size_mib': round(release.stat().st_size / 1024**2, 2), 'sha256': checksum, 'redacted_files': changes}, indent=2))
