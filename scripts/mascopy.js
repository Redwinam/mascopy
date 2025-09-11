#!/usr/bin/env node

/**
 * MasCopy CLI - 简化构建/打包/发布流程
 * 用法示例：
 *   - 版本号：  node scripts/mascopy.js bump 2.1.1
 *   - 构建：    node scripts/mascopy.js build [--install]
 *   - 签名：    node scripts/mascopy.js sign
 *   - 发布：    node scripts/mascopy.js release [--arch arm64]
 *   - 全流程：  node scripts/mascopy.js all [--install] [--sign] [--release] [--arch arm64]
 *   - 环境检查：node scripts/mascopy.js check
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PKG_PATH = path.join(ROOT, 'package.json');
const PUB_SCRIPT = path.join(ROOT, 'publish_release.sh');

function log(msg) { console.log(`[mascopy] ${msg}`); }
function err(msg) { console.error(`[mascopy] ERROR: ${msg}`); }

function run(cmd, args = [], opts = {}) {
  log(`运行: ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT, shell: false, ...opts });
  if (res.status !== 0) {
    throw new Error(`${cmd} 退出码 ${res.status}`);
  }
}

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function updatePublishVersion(newVersion) {
  if (!fs.existsSync(PUB_SCRIPT)) {
    log('publish_release.sh 不存在，跳过版本同步');
    return;
  }
  const content = fs.readFileSync(PUB_SCRIPT, 'utf-8');
  const newTag = `v${newVersion}`;
  const updated = content.replace(/^(VERSION\s*=\s*")v?[^\"]+("\s*)$/m, `$1${newTag}$2`);
  if (updated === content) {
    // 尝试替换常见格式
    const updated2 = content.replace(/VERSION=\"v[^\"]*\"/m, `VERSION=\"${newTag}\"`);
    if (updated2 === content) {
      log('未能在 publish_release.sh 中定位 VERSION 行，跳过');
      return;
    }
    fs.writeFileSync(PUB_SCRIPT, updated2);
  } else {
    fs.writeFileSync(PUB_SCRIPT, updated);
  }
  log(`已同步 publish_release.sh 版本为 ${newTag}`);
}

function cmdBump(args) {
  const newVersion = args[0];
  if (!newVersion) {
    err('请提供新版本号，例如：bump 2.1.1');
    process.exit(1);
  }
  const pkg = readJSON(PKG_PATH);
  const oldVersion = pkg.version;
  pkg.version = newVersion;
  writeJSON(PKG_PATH, pkg);
  log(`package.json 版本: ${oldVersion} -> ${newVersion}`);
  updatePublishVersion(newVersion);
}

function cmdBuild(opts) {
  if (opts.install) {
    run('npm', ['install']);
  }
  run('npm', ['run', 'build-mac']);
  // 兼容 electron-builder 在 macOS 下按架构输出的目录
  const appCandidates = [
    path.join(ROOT, 'dist', 'mac', 'MasCopy.app'),
    path.join(ROOT, 'dist', 'mac-arm64', 'MasCopy.app'),
    path.join(ROOT, 'dist', 'mac-x64', 'MasCopy.app')
  ];
  const hasApp = appCandidates.some(p => fs.existsSync(p));
  const distDir = path.join(ROOT, 'dist');
  const hasDMG = fs.existsSync(distDir) && fs.readdirSync(distDir).some(f => /^MasCopy-.*\.dmg$/.test(f));
  if (!hasApp && !hasDMG) {
    err('未找到构建产物；请检查 electron-builder 输出日志');
    process.exit(1);
  }
  if (!hasApp && hasDMG) {
    log('检测到 DMG 已生成，但 .app 目录结构可能为 dist/mac-arm64 或 dist/mac-x64（由 electron-builder 决定）');
  }
  log('构建完成');
}

function cmdSign() {
  const script = path.join(ROOT, 'sign_app.sh');
  if (!fs.existsSync(script)) {
    err('sign_app.sh 不存在，无法签名');
    process.exit(1);
  }
  run('bash', [script]);
}

function cmdRelease(opts) {
  const arch = opts.arch || 'arm64';
  const pkg = readJSON(PKG_PATH);
  const dmg = path.join(ROOT, 'dist', `MasCopy-${pkg.version}-${arch}.dmg`);
  if (!fs.existsSync(dmg)) {
    err(`未找到 DMG: ${path.relative(ROOT, dmg)}，请先执行构建`);
    process.exit(1);
  }
  const script = path.join(ROOT, 'publish_release.sh');
  if (!fs.existsSync(script)) {
    err('publish_release.sh 不存在，无法发布');
    process.exit(1);
  }
  run('bash', [script]);
}

function cmdAll(opts) {
  cmdBuild({ install: !!opts.install });
  if (opts.sign) {
    cmdSign();
  }
  if (opts.release) {
    cmdRelease({ arch: opts.arch });
  }
}

function cmdCheck() {
  try { run('node', ['-v']); } catch {}
  try { run('npm', ['-v']); } catch {}
  try { run('electron-builder', ['--version']); } catch { log('electron-builder 未全局安装，构建时会使用本地依赖'); }
  try { run('gh', ['--version']); } catch { log('gh 未安装，发布阶段会引导安装/登录'); }
  log('检查完成');
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const cmd = args.shift();
  const opts = {};
  // 简易解析 --key value / --flag
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.replace(/^--/, '');
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        opts[key] = next;
        i++;
      } else {
        opts[key] = true;
      }
    } else {
      // 非 -- 形式的参数，交给各子命令处理（例如 bump 的新版本号）
      if (!opts._) opts._ = [];
      opts._.push(a);
    }
  }
  return { cmd, opts };
}

function printHelp() {
  console.log(`
MasCopy CLI - 用于构建/打包/发布

用法：
  node scripts/mascopy.js bump <version>     例如 2.1.1（会同步 publish_release.sh）
  node scripts/mascopy.js build [--install]  构建 mac 应用与 DMG
  node scripts/mascopy.js sign               对 dist/mac/MasCopy.app 进行自签名
  node scripts/mascopy.js release [--arch arm64]  调用 publish_release.sh 发布到 GitHub
  node scripts/mascopy.js all [--install] [--sign] [--release] [--arch arm64]
  node scripts/mascopy.js check              检查环境依赖

也可通过 npm：
  npm run mascopy -- <subcommand> [options]
`);
}

(function main() {
  const { cmd, opts } = parseArgs(process.argv);
  try {
    switch (cmd) {
      case 'bump':
        cmdBump(opts._ || []);
        break;
      case 'build':
        cmdBuild(opts);
        break;
      case 'sign':
        cmdSign();
        break;
      case 'release':
        cmdRelease(opts);
        break;
      case 'all':
        cmdAll(opts);
        break;
      case 'check':
        cmdCheck();
        break;
      case 'help':
      case undefined:
        printHelp();
        break;
      default:
        err(`未知命令: ${cmd}`);
        printHelp();
        process.exit(1);
    }
  } catch (e) {
    err(e.message || String(e));
    process.exit(1);
  }
})();