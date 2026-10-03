const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const shot = async (n) => { await p.waitForTimeout(700); await p.screenshot({ path: `shots/${n}.png` }); console.log('ok', n); };
  await p.goto('http://localhost:8765/auth.html'); await p.waitForTimeout(1500);
  await shot('01-type');
  const force = (view, step, tot) => p.evaluate(([v, s, t]) => {
    document.querySelectorAll('.view').forEach(x => x.classList.toggle('active', x.id === 'v-' + v));
    document.body.dataset.view = v; document.getElementById('head').classList.remove('hide');
    document.getElementById('progress').style.visibility = 'visible';
    document.getElementById('stepLabel').textContent = `Step ${s} of ${t}`; document.getElementById('bar').style.width = (s / t * 100) + '%';
  }, [view, step, tot]);
  // real UI: create account -> phone
  await p.click('#goSignup'); await p.waitForTimeout(600); await shot('02-phone-empty');
  await p.fill('#phone', '0241234567'); await shot('03-phone-filled');
  // code (forced)
  await force('code', 2, 5);
  await p.evaluate(() => { const o = document.getElementById('otp'); if (!o.children.length) o.innerHTML = Array.from({length:6},(_,i)=>`<input style="--i:${i}" inputmode="numeric" maxlength="1">`).join(''); [...o.querySelectorAll('input')].forEach((x,i)=>x.value='482915'[i]); const b=document.getElementById('codeNext'); b.disabled=false; document.getElementById('codeSub').textContent='Enter the confirmation code sent to +233 24 123 4567.'; });
  await shot('04-code');
  await force('name', 3, 5); await p.evaluate(() => { document.getElementById('nameTitle').textContent='Your name'; const n=document.getElementById('name'); n.value='Kwame Mensah'; document.getElementById('nameNext').disabled=false; }); await shot('05-name');
  await force('cat', 4, 5); await p.evaluate(() => { document.getElementById('catTitle').textContent='What do you do?'; const ic='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.500V7M3 13h18"/></svg>'; document.getElementById('cats').innerHTML=['Electrician','Plumber','Mason and bricklayer','Carpenter','Tiler','Painter','Welder'].map((n,i)=>`<button class="cat ${i==0?'on':''}"><span class="ic">${ic}</span><span><b>${n}</b></span></button>`).join(''); }); await shot('06-cat');
  await force('pass', 5, 5); await p.evaluate(() => { const x=document.getElementById('pass'); x.value='Bx#2026pass'; x.dispatchEvent(new Event('input',{bubbles:true})); }); await shot('07-pass');
  // sign in
  await p.goto('http://localhost:8765/auth.html'); await p.waitForTimeout(1200);
  await p.click('#goSignin'); await p.waitForTimeout(800); await shot('08-signin-empty');
  await p.fill('#siPhone', '0241234567'); await p.fill('#siPass', 'Bx#2026pass'); await shot('09-signin-filled');
  await p.click('#seg button[data-m=email]'); await p.waitForTimeout(500); await p.fill('#siEmail', 'kwame@example.com'); await shot('10-signin-email');
  await b.close();
})();
