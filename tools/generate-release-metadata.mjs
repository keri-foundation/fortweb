import { readFileSync, writeFileSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const zipPath = process.argv[2];
if (!zipPath) {
  console.error('Usage: node tools/generate-release-metadata.mjs <path-to-zip>');
  process.exit(1);
}

try {
  const zipBuffer = readFileSync(zipPath);
  const sha256 = createHash('sha256').update(zipBuffer).digest('hex');
  const bytes = statSync(zipPath).size;
  const zipName = basename(zipPath);

  const pkgPath = join(__dirname, '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const version = pkg.version || '0.0.0';

  const repo = process.env.GITHUB_REPOSITORY || 'keri-foundation/fortweb';
  const commitSha = process.env.GITHUB_SHA || 'unknown';
  const ref = process.env.GITHUB_REF || 'refs/heads/main';
  const refName = process.env.GITHUB_REF_NAME || 'main';
  const workflow = process.env.GITHUB_WORKFLOW || '.github/workflows/fortweb-runtime-package.yml';
  const workflowIdentity = `https://github.com/${repo}/${workflow}@${ref}`;

  const metadata = {
    schema_version: "1.0.0",
    package_version: version,
    repository: repo,
    commit_sha: commitSha,
    ref: ref,
    ref_name: refName,
    workflow: workflow,
    workflow_identity: workflowIdentity,
    artifact_name: zipName,
    artifact_sha256: sha256,
    artifact_bytes: bytes,
    runtime_origin: "https://appassets.androidplatform.net",
    entrypoint: "app/index.html",
    attestation: {
      type: "github-artifact-attestation",
      required: true,
      verify_command: `gh attestation verify ${zipName} --repo ${repo} --cert-identity-regexp "^https://github.com/${repo}/${workflow}@refs/(heads/main|tags/v.*)"$`
    }
  };

  const dir = dirname(zipPath);
  const metadataPath = join(dir, 'fortweb-release.json');

  writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + '\n');
  console.log(`Generated metadata: ${metadataPath}`);
} catch (error) {
  console.error('Failed to generate release metadata:', error.message);
  process.exit(1);
}
