# ALPHA Browser — GitHub APK Build

இந்த project GitHub Actions மூலம் debug APK உருவாக்கும் ஆரம்ப browser prototype.

## Android phone-ல் செய்ய வேண்டியது

1. இந்த ZIP-ஐ extract செய்யவும்.
2. GitHub-ல் புதிய repository உருவாக்கவும்: `alpha-browser`
3. Extract செய்த project-இன் எல்லா files/folders-ஐ repository-க்கு upload செய்து commit செய்யவும்.
4. GitHub repository → **Actions** → **Build ALPHA Browser APK** → **Run workflow**.
5. Workflow முடிந்ததும் run-ஐ திறந்து **Artifacts** பகுதியில் `ALPHA-Browser-debug-apk`-ஐ download செய்யவும்.
6. ZIP-ஐ extract செய்து `app-debug.apk` install செய்யவும். Android கேட்கும் போது அந்த browser-க்கு மட்டும் install permission வழங்கவும்.

## தற்போதைய வரம்புகள் — முக்கியம்

- இது ஆரம்ப WebView browser prototype; production browser அல்ல.
- Camera/microphone permission handling சேர்க்கப்பட்டுள்ளது; ஆனால் WhatsApp Web voice/video calling எல்லா Android/WebView/WhatsApp account சூழல்களிலும் வேலை செய்யும் என்று உறுதி இல்லை.
- **ZIP Import button placeholder மட்டுமே.** இந்த build Manifest V3 extension-களை இயக்காது. உண்மையான extension engine, service worker, content-script injection, permissions மற்றும் Android compatibility தனியாக உருவாக்கி சோதிக்க வேண்டும்.
- Tabs, downloads, bookmarks, Bluetooth call routing, background call service, release signing ஆகியவை இன்னும் சேர்க்கப்படவில்லை.
- இது debug APK; Play Store release-ready APK அல்ல.

GitHub Actions build failure வந்தால் Actions log-ஐ பகிரவும். அந்த error-ஐ வைத்து project-ஐ சரிசெய்யலாம்.
