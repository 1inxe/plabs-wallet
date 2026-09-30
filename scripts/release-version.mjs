import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export function releaseVersion(base, manifestVersion, env) {
  if (base !== manifestVersion) throw new Error('package.json and manifest.json versions must match');
  if (!/^\d+\.\d+\.\d+$/.test(base) || base.split('.').some(part => Number(part) > 65535 || String(Number(part)) !== part)) {
    throw new Error('Base version must have three integer components from 0 to 65535');
  }
  let version = base;
  if (env.GITHUB_REF_TYPE === 'tag') {
    version = (env.GITHUB_REF_NAME ?? '').replace(/^v/, '');
    if (env.GITHUB_REF_NAME !== `v${version}` || (version !== base && !version.startsWith(`${base}.`))) {
      throw new Error(`Release tag must match v${base} or v${base}.BUILD`);
    }
  } else if (env.GITHUB_REF === 'refs/heads/main') {
    version = `${base}.${env.GITHUB_RUN_NUMBER}`;
  }
  if (!/^\d+\.\d+\.\d+(\.\d+)?$/.test(version) || version.split('.').some(part => Number(part) > 65535 || String(Number(part)) !== part)) {
    throw new Error('Invalid Chrome extension version; build number must be between 0 and 65535');
  }
  return { version, tag: `v${version}` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const manifest = JSON.parse(fs.readFileSync('public/manifest.json', 'utf8'));
  const { version, tag } = releaseVersion(pkg.version, manifest.version, process.env);
  // Stamp only the build checkout. The tag points to the exact source commit.
  pkg.version = manifest.version = version;
  fs.writeFileSync('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
  fs.writeFileSync('public/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\ntag=${tag}\n`);
  console.log(`Release version: ${version}, tag: ${tag}`);
}
