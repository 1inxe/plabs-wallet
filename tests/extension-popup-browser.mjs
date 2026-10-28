import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { browserRuntime } from './browser-runtime.mjs';
import { registerHooks } from 'node:module';
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier))
        return next(specifier + '.ts', context);
      throw error;
    }
  },
});
const { encryptPrivateKey } = await import('../src/shared/vault.ts');
const fixturePassword = 'Popup-fixture-1234';
const fixtureVault = await encryptPrivateKey('11'.repeat(32), fixturePassword);

// A real toolbar popup, with no fixed Playwright viewport hiding intrinsic-size bugs.
const cft = join(
  homedir(),
  'Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
);
if (!process.env.NFT_BROWSER_PATH && existsSync(cft))
  process.env.NFT_BROWSER_PATH = cft;
const { chromium, executablePath } = await browserRuntime();
const profile = await mkdtemp(join(tmpdir(), 'plabs-wallet-popup-test-'));
const artifacts = join(tmpdir(), 'plabs-wallet-popup-test-artifacts');
await mkdir(artifacts, { recursive: true });
const extension = resolve('dist');
const context = await chromium.launchPersistentContext(profile, {
  headless: false,
  executablePath,
  viewport: null,
  args: [
    '--disable-extensions-except=' + extension,
    '--load-extension=' + extension,
    '--window-size=1100,850',
  ],
});
let cdp;
try {
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  cdp = await context.browser().newBrowserCDPSession();
  const open = async () => {
    await worker.evaluate(async () => {
      const [window] = await chrome.windows.getAll({ windowTypes: ['normal'] });
      if (window?.id === undefined)
        throw Error('Popup fixture has no browser window');
      await chrome.windows.update(window.id, { focused: true });
      await chrome.action.openPopup({ windowId: window.id });
    });
    let target;
    for (let attempt = 0; attempt < 50; attempt++) {
      const targets = await cdp.send('Target.getTargets');
      target = targets.targetInfos.find(
        (t) => t.url === worker.url().replace('background.js', 'popup.html'),
      );
      if (target) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(target, 'Chrome created a toolbar popup');
    const { sessionId } = await cdp.send('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: false,
    });
    let serial = 0;
    const command = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++serial;
        const timer = setTimeout(() => {
          cdp.off('Target.receivedMessageFromTarget', receive);
          reject(Error('Popup CDP timeout: ' + method));
        }, 25000);
        const receive = (event) => {
          if (event.sessionId !== sessionId) return;
          const data = JSON.parse(event.message);
          if (data.id !== id) return;
          clearTimeout(timer);
          cdp.off('Target.receivedMessageFromTarget', receive);
          data.error ? reject(Error(data.error.message)) : resolve(data.result);
        };
        cdp.on('Target.receivedMessageFromTarget', receive);
        cdp
          .send('Target.sendMessageToTarget', {
            sessionId,
            message: JSON.stringify({ id, method, params }),
          })
          .catch(reject);
      });
    for (let attempt = 0; attempt < 60; attempt++) {
      const result = await command('Runtime.evaluate', {
        expression: "Boolean(document.querySelector('.wallet-shell'))",
        returnByValue: true,
      });
      if (result.result.value) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    return { command, target };
  };
  for (const mode of ['setup', 'locked', 'locked-zh']) {
    if (mode === 'locked')
      await worker.evaluate(async (vault) => {
        await chrome.storage.local.set({
          walletAccounts: [
            {
              id: 'popup-layout-fixture',
              name: '布局测试',
              address: vault.address,
              vault,
              createdAt: Date.now(),
            },
          ],
          activeWalletAccountId: 'popup-layout-fixture',
          walletUiLanguage: 'en',
        });
      }, fixtureVault);
    if (mode === 'locked-zh')
      await worker.evaluate(() =>
        chrome.storage.local.remove('walletUiLanguage'),
      );
    const { command, target } = await open();
    const result = await command('Runtime.evaluate', {
      expression: `JSON.stringify({width:innerWidth,height:innerHeight,htmlWidth:document.documentElement.getBoundingClientRect().width,bodyWidth:document.body.getBoundingClientRect().width,horizontalOverflow:document.documentElement.scrollWidth>innerWidth,passwordWidth:document.querySelector('.password-field input')?.getBoundingClientRect().width,heading:document.querySelector('h1')?.textContent,language:document.documentElement.lang,placeholder:document.querySelector('.password-field input')?.getAttribute('placeholder')})`,
      returnByValue: true,
    });
    const size = JSON.parse(result.result.value);
    assert.equal(size.width, 370);
    assert.equal(size.htmlWidth, 370);
    assert.equal(size.bodyWidth, 370);
    assert.equal(size.horizontalOverflow, false);
    assert.ok(size.passwordWidth >= 300);
    if (mode !== 'setup') assert.equal(size.heading, 'PLabs Wallet');
    assert.equal(size.language, mode === 'locked' ? 'en' : 'zh-CN');
    if (mode !== 'setup')
      assert.equal(
        size.placeholder,
        mode === 'locked' ? 'Enter wallet password' : '请输入钱包主密码',
      );
    const shot = await command('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    });
    await writeFile(
      join(artifacts, mode + '.png'),
      Buffer.from(shot.data, 'base64'),
    );
    console.log(
      'PASS actual Chrome toolbar popup ' + mode + ' ' + JSON.stringify(size),
    );
    if (mode === 'locked' && process.env.LIVE_PRICE_CHECK === '1') {
      const result = await command('Runtime.evaluate', {
        expression: `(async()=>{const unlock=await chrome.runtime.sendMessage({action:'UNLOCK',password:${JSON.stringify(fixturePassword)}});if(!unlock.ok)throw Error(unlock.error.message);const response=await chrome.runtime.sendMessage({action:'GET_MARKET_PRICES',chainId:1,contracts:[]});if(!response.ok)throw Error(response.error.message);return JSON.stringify(response.result);})()`,
        awaitPromise: true,
        returnByValue: true,
      });
      assert.equal(result.exceptionDetails, undefined);
      const book = JSON.parse(result.result.value);
      assert.ok(
        book.quotes['1:native'].usd > 0,
        'Real background fetch obtains an ETH price',
      );
      assert.ok(
        book.quotes['1:private:0xed16fa3238d9814f194579baf75caecd75f015da']
          .usd > 0,
        'sETH inherits the actual ETH quote',
      );
      assert.ok(
        book.quotes['1:private:0xfc8bf8b613cae37db53003ec6a306a62d5a0b7c5']
          .usd > 0,
        'sUSDC inherits the actual USDC quote',
      );
      console.log(
        'PASS actual extension background live USD quotes and 24h change ' +
          JSON.stringify({
            eth: book.quotes['1:native'],
            usdc: book.quotes[
              '1:private:0xfc8bf8b613cae37db53003ec6a306a62d5a0b7c5'
            ],
          }),
      );
    }
    if (mode === 'locked-zh') {
      const unlock = await command('Runtime.evaluate', {
        expression: `(async()=>{const r=await chrome.runtime.sendMessage({action:'UNLOCK',password:${JSON.stringify(fixturePassword)}});if(!r.ok)throw Error(r.error.message);return true})()`,
        awaitPromise: true,
        returnByValue: true,
      });
      assert.equal(unlock.exceptionDetails, undefined);
      for (let i = 0; i < 60; i++) {
        const ready = await command('Runtime.evaluate', {
          expression: "Boolean(document.querySelector('.wallet-navigation'))",
          returnByValue: true,
        });
        if (ready.result.value) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      for (const [language, names] of [
        ['zh-CN', ['藏品', '活动', '设置', '资产', '藏品', '设置', '资产']],
        ['en', ['Collectibles', 'Activity', 'Settings', 'Assets']],
      ]) {
        await worker.evaluate(
          (language) =>
            chrome.storage.local.set({ walletUiLanguage: language }),
          language,
        );
        for (let i = 0; i < 60; i++) {
          const ready = await command('Runtime.evaluate', {
            expression: `document.documentElement.lang === ${JSON.stringify(language)}`,
            returnByValue: true,
          });
          if (ready.result.value) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        for (const targetName of names) {
          const prepared = await command('Runtime.evaluate', {
            expression: `(async()=>{
              await document.fonts.ready;
              const nav=document.querySelector('.wallet-navigation');
              const rect=node=>{const r=node.getBoundingClientRect();return [r.x,r.y,r.width,r.height]};
              const collect=()=>({viewport:[innerWidth,innerHeight,outerWidth,outerHeight,devicePixelRatio],nav:[nav,...nav.querySelectorAll('button,svg')].map(rect),scroll:[scrollY,document.documentElement.clientWidth],header:rect(document.querySelector('.account-header'))});
              window.scrollTo(0,document.documentElement.scrollHeight);
              await new Promise(requestAnimationFrame);
              const before=collect();
              const button=[...nav.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===${JSON.stringify(targetName)});
              if(!button)throw Error('Missing navigation target');
              button.addEventListener('click',()=>{
                window.__navFrames=new Promise(resolve=>{
                  const frames=[];
                  const tick=()=>{frames.push(collect());if(frames.length===30)resolve(JSON.stringify({before,frames}));else requestAnimationFrame(tick)};
                  requestAnimationFrame(tick);
                });
              },{once:true});
              return JSON.stringify(rect(button));
            })()`,
            awaitPromise: true,
            returnByValue: true,
          });
          assert.equal(prepared.exceptionDetails, undefined);
          const [x, y, width, height] = JSON.parse(prepared.result.value);
          await command('Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            x: x + width / 2,
            y: y + height / 2,
          });
          await command('Input.dispatchMouseEvent', {
            type: 'mousePressed',
            button: 'left',
            buttons: 1,
            clickCount: 1,
            x: x + width / 2,
            y: y + height / 2,
          });
          await command('Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            button: 'left',
            buttons: 0,
            clickCount: 1,
            x: x + width / 2,
            y: y + height / 2,
          });
          const measured = await command('Runtime.evaluate', {
            expression: 'window.__navFrames',
            awaitPromise: true,
            returnByValue: true,
          });
          assert.equal(measured.exceptionDetails, undefined);
          const sample = JSON.parse(measured.result.value);
          await writeFile(
            join(artifacts, 'nav-' + targetName + '.json'),
            JSON.stringify(sample, null, 2),
          );
          assert.ok(
            sample.frames.every(
              (frame) =>
                JSON.stringify(frame.nav) === JSON.stringify(sample.before.nav),
            ),
            'Every icon keeps the same geometry through the actual click: ' +
              targetName,
          );
          assert.equal(
            sample.before.nav[0][2],
            334,
            'The native scrollbar cannot shrink the floating bar',
          );
          assert.ok(
            sample.frames.every(
              (frame) =>
                JSON.stringify(frame.viewport) ===
                JSON.stringify(sample.before.viewport),
            ),
            'Chrome keeps the same popup dimensions',
          );
          assert.ok(
            sample.frames.every((frame) => frame.scroll[0] === 0),
            'Scrolling resets before the first painted frame: ' + targetName,
          );
          console.log(
            'PASS real toolbar navigation frames ' +
              JSON.stringify({
                target: targetName,
                deviceScale: sample.before.viewport[4],
                width: sample.before.nav[0][2],
                frames: sample.frames.length,
              }),
          );
        }
      }
      const screenshot = await command('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      });
      await writeFile(
        join(artifacts, 'dashboard-floating.png'),
        Buffer.from(screenshot.data, 'base64'),
      );
    }
    await cdp.send('Target.closeTarget', { targetId: target.targetId });
  }
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
console.log('Screenshots: ' + artifacts);
