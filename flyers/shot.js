const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1100, height: 1400 } });
 for (const n of ['flyer1', 'flyer2', 'flyer3', 'flyer4', 'flyer5', 'flyer6', 'flyer7', 'flyer8', 'flyer9', 'flyer10', 'flyer11', 'flyer12']) { await p.goto('file://' + __dirname + '/' + n + '.html'); await p.waitForTimeout(500); await (await p.$('.fl')).screenshot({ path: n + '.png', timeout: 90000 }); }
 await b.close(); })();
