"""Package built assets with an integrity gate and deterministic ZIP metadata.
This is a packaging check, not a wallet regression or an upstream security audit.
"""
from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parents[1]
dist = root / 'dist'
manifest = json.loads((dist / 'manifest.json').read_text())
if manifest != json.loads((root / 'public/manifest.json').read_text()):
    raise SystemExit('Manifest is stale; build before packaging.')
for asset in json.loads((root / 'scripts/vendor-assets.lock.json').read_text())['assets']:
    path = dist / asset['path']
    if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != asset['sha256']:
        raise SystemExit(f"Vendored asset differs from the recorded baseline: {asset['path']}")

release = root / 'releases' / f"plabs-wallet-extension-{manifest['version']}-store.zip"
release.parent.mkdir(parents=True, exist_ok=True)
allowed_suffixes = {'.html', '.js', '.css', '.json', '.svg', '.png', '.ttf', '.wasm', '.zkey', '.sha256'}
files = []
for file in sorted(dist.rglob('*')):
    if file.is_symlink():
        raise SystemExit('Refusing symlink in dist.')
    if not file.is_file():
        continue
    relative = file.relative_to(dist)
    if relative.as_posix() in {'dapp.html', 'dapp.js'} or (relative.parent.as_posix() == 'assets' and file.name.startswith('dapp-') and file.suffix == '.css'):
        continue
    if file.name == '.DS_Store' or file.suffix == '.map':
        continue
    if any(part.startswith('.') for part in relative.parts) or file.suffix not in allowed_suffixes:
        raise SystemExit(f'Unexpected release file; review it before packaging: {relative}')
    files.append((file, relative))

staged = release.with_suffix('.zip.tmp')
try:
    with zipfile.ZipFile(staged, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for file, relative in files:
            info = zipfile.ZipInfo(relative.as_posix(), date_time=(2020, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, file.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    staged.replace(release)
finally:
    staged.unlink(missing_ok=True)
checksum = hashlib.sha256(release.read_bytes()).hexdigest()
release.with_suffix(release.suffix + '.sha256').write_text(f'{checksum}  {release.name}\n')
print(f'Created {release.name} ({release.stat().st_size / (1024 * 1024):.1f} MiB), {len(files)} files; baseline asset hashes matched.')
