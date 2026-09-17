from pathlib import Path
import re

path = Path("index.html")
text = path.read_text(encoding="utf-8")

old_font = "https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@400;500;600;700&display=swap"
new_font = "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=Noto+Serif+TC:wght@400;500;600;700&display=swap"
text = text.replace(old_font, new_font)

marker = "/* OFFICIAL_SITE_FOOTER_SYNC_20260918 */"
footer_css = r'''
/* OFFICIAL_SITE_FOOTER_SYNC_20260918 */
footer.footer{
  width:100vw;
  margin:48px 0 -42px calc(50% - 50vw);
  border-top:1px solid #dedede!important;
  padding:38px 5vw 42px;
  background:#fff;
  color:#4a4a4a!important;
  font-size:14px;
  line-height:1.9;
  letter-spacing:.06em;
  text-align:left;
}
footer.footer,footer.footer *{font-family:'Cormorant Garamond','Noto Serif TC','Source Han Serif TC','Source Han Serif','思源宋體','Songti TC',serif!important}
footer.footer .footer-grid{
  max-width:1320px;
  margin:0 auto;
  display:grid!important;
  grid-template-columns:minmax(0,1.35fr) minmax(180px,.75fr) minmax(200px,.8fr)!important;
  column-gap:clamp(42px,6vw,96px)!important;
  row-gap:0!important;
  align-items:start!important;
}
footer.footer b{color:#111;font-weight:600;letter-spacing:.12em}
footer.footer a{color:inherit;text-decoration:none;border-bottom:1px solid transparent}
footer.footer a:hover{color:#111;border-bottom-color:#111}
footer.footer .footer-col{min-width:0;overflow-wrap:normal;word-break:keep-all}
footer.footer .footer-brand-col{line-height:1.85!important}
footer.footer .footer-brand-title{display:block;margin-bottom:24px}
footer.footer .footer-brand-meta{display:block;margin-bottom:24px}
footer.footer .footer-brand-copy{display:block;margin-bottom:24px}
footer.footer .footer-social-col{display:flex!important;align-items:flex-start!important;justify-content:flex-start!important;text-align:left!important;padding:4px 0 0!important}
footer.footer .footer-social-links{display:flex;align-items:center;gap:20px;flex-wrap:wrap}
footer.footer .footer-social-link{display:inline-flex!important;align-items:center!important;justify-content:center!important;width:30px;height:30px;border:0!important}
footer.footer .footer-social-link img{display:block;width:26px;height:26px;object-fit:contain}
footer.footer .footer-right-col .footer-actions{display:flex!important;flex-direction:column!important;align-items:flex-start!important;gap:11px!important}
footer.footer .footer-right-col .footer-action{display:inline!important;width:auto!important;padding:0!important;border:0!important;background:transparent!important;color:inherit!important;box-shadow:none!important;text-decoration:none!important}
footer.footer .footer-bottom{grid-column:1/-1;display:flex;justify-content:space-between;gap:24px;margin-top:42px;padding-top:18px;border-top:1px solid #dedede;color:#767676;font-size:12px}
footer.footer .footer-legal{margin:0!important;padding:0!important;border:0!important;text-align:right!important;font-size:12px!important;line-height:1.9!important}
@media(max-width:900px){
  footer.footer .footer-grid{grid-template-columns:minmax(0,1.25fr) minmax(160px,.75fr)!important;column-gap:42px!important;row-gap:34px!important}
  footer.footer .footer-right-col{grid-column:2;grid-row:1}
  footer.footer .footer-social-col{grid-column:1/-1;grid-row:2}
  footer.footer .footer-bottom{grid-row:3}
}
@media(max-width:760px){
  footer.footer{margin-top:36px;padding:32px 5vw 36px;font-size:13px}
  footer.footer .footer-grid{display:block!important}
  footer.footer .footer-brand-col,footer.footer .footer-social-col,footer.footer .footer-right-col{margin:0 0 30px!important}
  footer.footer .footer-bottom{display:block;margin-top:10px}
  footer.footer .footer-legal{text-align:left!important;margin-top:8px!important}
}
'''

if marker not in text:
    text = text.replace("</style>", footer_css + "\n</style>", 1)

footer_html = '''<footer class="footer">
  <div class="footer-grid">
    <div class="footer-col footer-brand-col"><b class="footer-brand-title">HANA SCENT ARTIST</b><span class="footer-brand-meta">Hana 沈秉儀｜嗅覺藝術家・調香師・Creative Mentor<br>OLFACTORY ARTIST · PERFUMER · CREATIVE MENTOR</span><span class="footer-brand-copy">從創作開始，讓想像真正落地。</span>藝術育成｜品牌合作｜專業調香<br>藝術駐村計畫　<a href="https://hanascent.com/ciyu/">此域 HINENI</a></div>
    <div class="footer-col footer-social-col"><div class="footer-social-links"><a class="footer-social-link" href="https://www.instagram.com/hanas.scent/" target="_blank" rel="noopener" aria-label="Instagram"><img src="/assets/footer-instagram.svg" alt=""></a><a class="footer-social-link" href="https://www.facebook.com/Hanas017" target="_blank" rel="noopener" aria-label="Facebook"><img src="/assets/footer-facebook.svg" alt=""></a><a class="footer-social-link" href="https://lin.ee/OI4bzr1" target="_blank" rel="noopener" aria-label="官方 LINE"><img src="/assets/footer-line.svg" alt=""></a><a class="footer-social-link" href="mailto:hanascent@gmail.com" aria-label="Email"><img src="/assets/footer-email.svg" alt=""></a></div></div>
    <div class="footer-col footer-right-col"><div class="footer-actions"><a class="footer-action" href="https://reservation.hanascent.com/">預約課程</a><a class="footer-action" href="https://hanascent.com/member/">訂閱氣味通信</a><a class="footer-action" href="https://hanascent.com/student-tools/">學員工具</a></div></div>
    <div class="footer-bottom"><div>© 2026 Hana Scent Artist</div><div class="footer-legal"><a href="https://hanascent.com/course-info/">課程交易與履約資訊</a>　·　<a href="https://hanascent.com/terms/">消費者權益與服務條款</a>　·　<a href="https://hanascent.com/privacy/">隱私權政策</a>　·　<a href="https://hanascent.com/refund/">退換貨與退款政策</a></div></div>
  </div>
</footer>'''

pattern = re.compile(r'<footer(?:\s+class="footer")?>.*?</footer>', re.S)
text, count = pattern.subn(footer_html, text, count=1)
if count != 1:
    raise SystemExit("Expected exactly one footer to replace")

path.write_text(text, encoding="utf-8")
