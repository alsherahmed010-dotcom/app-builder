package com.myapp.downloader

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.ArrowForward
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

data class Vid(val url: String, val title: String, val quality: String)
data class Dl(val id: Long, val name: String)
val detected = mutableStateListOf<Vid>()
val myDownloads = mutableStateListOf<Dl>()

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { MaterialTheme { Root() } }
    }
}

@Composable
fun Root() {
    var screen by remember { mutableStateOf("home") }
    var query by remember { mutableStateOf("") }
    when (screen) {
        "browser" -> BrowserScreen(query, { query = "" }, { screen = "home" }, { screen = "downloads" }, { screen = "menu" })
        "downloads" -> DownloadsScreen { screen = "home" }
        "menu" -> MenuScreen({ screen = "home" }, { screen = "downloads" }, { screen = "history" })
        "history" -> HistoryScreen({ screen = "home" }) { q -> query = q; screen = "browser" }
        else -> HomeScreen({ q -> query = q; screen = "browser" }, { screen = "downloads" }, { screen = "menu" }, { screen = "history" })
    }
}

@Composable
fun HomeScreen(onSearch: (String) -> Unit, onDownloads: () -> Unit, onMenu: () -> Unit, onHistory: () -> Unit) {
    var q by remember { mutableStateOf("") }
    Column(Modifier.fillMaxSize().background(Color.Black)) {
        Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onMenu) { Icon(Icons.Default.Menu, "m", tint = Color(0xFF9CA3AF)) }
            Spacer(Modifier.weight(1f))
            Text("Ahmed", color = Color(0xFF3B82F6), fontSize = 22.sp)
            Spacer(Modifier.width(8.dp))
            IconButton(onClick = onHistory) { Icon(Icons.Default.Search, "h", tint = Color(0xFF9CA3AF)) }
        }
        Column(Modifier.weight(1f).fillMaxWidth(), Arrangement.Center, Alignment.CenterHorizontally) {
            Row {
                Box(Modifier.width(20.dp).height(70.dp).background(Color(0xFF1D4ED8)))
                Spacer(Modifier.width(6.dp))
                Box(Modifier.width(20.dp).height(70.dp).background(Color(0xFFDC2626)))
                Spacer(Modifier.width(6.dp))
                Box(Modifier.width(20.dp).height(70.dp).background(Color(0xFFD97706)))
            }
            Spacer(Modifier.height(20.dp))
            Text("متصفح + محمل فيديوهات", color = Color(0xFF9CA3AF), fontSize = 13.sp)
            Spacer(Modifier.height(50.dp))
            Surface(Modifier.fillMaxWidth(0.88f).height(54.dp), shape = RoundedCornerShape(30.dp),
                color = Color(0xFF0D0D12), border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFF26263A))) {
                Row(Modifier.fillMaxSize().padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
                    BasicTextField(value = q, onValueChange = { q = it }, singleLine = true,
                        textStyle = TextStyle(color = Color.White, fontSize = 15.sp),
                        cursorBrush = SolidColor(Color(0xFF3B82F6)), modifier = Modifier.weight(1f),
                        decorationBox = { inner ->
                            if (q.isEmpty()) Text("بحث أو أدخل عنوان URL...", color = Color(0xFF666666), fontSize = 14.sp)
                            inner()
                        })
                    IconButton(onClick = { if (q.isNotBlank()) onSearch(q.trim()) }) {
                        Icon(Icons.Default.Search, "go", tint = Color(0xFF3B82F6))
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(vertical = 14.dp), Arrangement.SpaceEvenly, Alignment.CenterVertically) {
            IconButton(onClick = onMenu) { Icon(Icons.Default.Menu, "m", tint = Color(0xFF9CA3AF), modifier = Modifier.size(26.dp)) }
            Box(Modifier.size(24.dp).border(2.dp, Color(0xFF9CA3AF), RoundedCornerShape(5.dp)), Alignment.Center) {
                Text("1", color = Color(0xFF9CA3AF), fontSize = 11.sp)
            }
            IconButton(onClick = {}) { Icon(Icons.Default.Home, "h", tint = Color(0xFF9CA3AF), modifier = Modifier.size(26.dp)) }
            IconButton(onClick = onDownloads) { Icon(Icons.Default.Download, "d", tint = Color(0xFF9CA3AF), modifier = Modifier.size(26.dp)) }
            IconButton(onClick = onMenu) { Icon(Icons.Default.Menu, "m2", tint = Color(0xFF9CA3AF), modifier = Modifier.size(26.dp)) }
        }
    }
}

class Bridge {
    @JavascriptInterface fun add(u: String, t: String, q: String) {
        if (u.isBlank() || u.startsWith("data:")) return
        if (detected.any { it.url == u }) return
        detected.add(Vid(u, t.ifBlank { "فيديو ${detected.size + 1}" }, q.ifBlank { "تلقائي" }))
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun BrowserScreen(query: String, onConsumed: () -> Unit, onHome: () -> Unit, onDownloads: () -> Unit, onMenu: () -> Unit) {
    val ctx = LocalContext.current
    var webView by remember { mutableStateOf<WebView?>(null) }
    var urlBar by remember { mutableStateOf("") }
    var showPicker by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    fun nav(input: String) {
        if (input.isBlank()) return
        val target = if (input.startsWith("http")) input
            else if (input.contains('.') && !input.contains(' ')) "https://$input"
            else "https://www.google.com/search?q=" + URLEncoder.encode(input, "UTF-8")
        webView?.loadUrl(target)
    }

    LaunchedEffect(query) { if (query.isNotBlank()) { nav(query); onConsumed() } }
    BackHandler { if (webView?.canGoBack() == true) webView?.goBack() else onHome() }

    Column(Modifier.fillMaxSize().background(Color.Black)) {
        Surface(color = Color(0xFF0D0D12)) {
            Column {
                Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = { if (webView?.canGoBack() == true) webView?.goBack() else onHome() }, modifier = Modifier.size(36.dp)) {
                        Icon(Icons.Default.ArrowBack, "b", tint = Color(0xFF9CA3AF), modifier = Modifier.size(20.dp))
                    }
                    Surface(Modifier.weight(1f).height(40.dp), shape = RoundedCornerShape(20.dp), color = Color(0xFF1A1A24)) {
                        Row(Modifier.fillMaxSize().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                            BasicTextField(value = urlBar, onValueChange = { urlBar = it }, singleLine = true,
                                textStyle = TextStyle(color = Color.White, fontSize = 13.sp),
                                cursorBrush = SolidColor(Color(0xFF3B82F6)), modifier = Modifier.weight(1f),
                                decorationBox = { inner ->
                                    if (urlBar.isEmpty()) Text("ابحث...", color = Color(0xFF666666), fontSize = 13.sp)
                                    inner()
                                })
                            IconButton(onClick = { nav(urlBar) }, modifier = Modifier.size(28.dp)) {
                                Icon(Icons.Default.Search, "g", tint = Color(0xFF3B82F6), modifier = Modifier.size(18.dp))
                            }
                        }
                    }
                    IconButton(onClick = { webView?.reload() }, modifier = Modifier.size(36.dp)) {
                        Icon(Icons.Default.Refresh, "r", tint = Color(0xFF9CA3AF), modifier = Modifier.size(20.dp))
                    }
                }
                if (loading) LinearProgressIndicator(Modifier.fillMaxWidth().height(2.dp))
            }
        }

        Box(Modifier.weight(1f).fillMaxWidth()) {
            AndroidView(modifier = Modifier.fillMaxSize(), factory = { c ->
                WebView(c).apply {
                    layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    settings.loadWithOverviewMode = true
                    settings.useWideViewPort = true
                    settings.mediaPlaybackRequiresUserGesture = false
                    settings.userAgentString = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
                    addJavascriptInterface(Bridge(), "AB")
                    webViewClient = object : WebViewClient() {
                        override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? {
                            val u = request?.url?.toString()?.lowercase() ?: return null
                            val bad = listOf("doubleclick","googlesyndication","googleadservices","google-analytics","googletagmanager","pagead2","adsystem","adservice","advertising.com","adnxs","adsrvr","taboola","outbrain","criteo","pubmatic","rubiconproject","openx","applovin","unityads","chartboost","vungle","ironsrc","inmobi","mopub","startapp","tapjoy","adjust.com","appsflyer","branch.io","amplitude","mixpanel","segment.io","flurry","scorecardresearch","quantserve","moatads","adsafeprotected","adroll","bidswitch","casalemedia","sharethrough","yieldmo","smartadserver","smaato","amazon-adsystem","bat.bing","doubleverify","googleads","popads","propellerads","adsterra","exoclick")
                            if (bad.any { u.contains(it) }) {
                                return WebResourceResponse("text/plain", "utf-8", java.io.ByteArrayInputStream(ByteArray(0)))
                            }
                            return null
                        }
                        override fun onPageStarted(v: WebView?, u: String?, f: android.graphics.Bitmap?) {
                            loading = true; if (u != null) urlBar = u
                        }
                        override fun onPageFinished(v: WebView?, u: String?) {
                            loading = false
                            if (u != null) urlBar = u
                            v?.evaluateJavascript(JS, null)
                            if (u != null && u.contains("tiktok.com")) {
                                scope.launch { extractTikTok(u).forEach { x -> if (detected.none { it.url == x.url }) detected.add(x) } }
                            }
                            if (u != null && (u.contains("youtube.com/watch") || u.contains("youtu.be/"))) {
                                scope.launch { extractYouTube(u).forEach { x -> if (detected.none { it.url == x.url }) detected.add(x) } }
                            }
                        }
                        override fun shouldOverrideUrlLoading(v: WebView?, r: WebResourceRequest?): Boolean {
                            val u = r?.url?.toString() ?: return false
                            if (u.endsWith(".mp4") || u.endsWith(".m3u8") || u.endsWith(".webm") || u.endsWith(".mkv")) {
                                if (detected.none { it.url == u }) detected.add(Vid(u, u.substringAfterLast('/').take(50), "مباشر"))
                                Toast.makeText(ctx, "تم كشف فيديو!", Toast.LENGTH_SHORT).show()
                                return true
                            }
                            if (!u.startsWith("http") && !u.startsWith("https")) return true
                            return false
                        }
                    }
                    loadUrl("https://www.google.com")
                    webView = this
                }
            })

            // الزر العائم الثابت أسفل يمين
            Surface(
                onClick = {
                    if (detected.isEmpty()) Toast.makeText(ctx, "شغّل الفيديو أولاً", Toast.LENGTH_SHORT).show()
                    else showPicker = true
                },
                shape = CircleShape,
                color = if (detected.isEmpty()) Color(0xFF2A2A3A) else Color(0xFF3B82F6),
                shadowElevation = 12.dp,
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(end = 16.dp, bottom = 16.dp)
                    .size(64.dp)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(Icons.Default.Download, "d", tint = Color.White, modifier = Modifier.size(22.dp))
                        Text(if (detected.isEmpty()) "0" else detected.size.toString(), color = Color.White, fontSize = 12.sp)
                    }
                }
            }
        }

        Surface(color = Color(0xFF0D0D12)) {
            Row(Modifier.fillMaxWidth().padding(vertical = 10.dp), Arrangement.SpaceEvenly, Alignment.CenterVertically) {
                IconButton(onClick = onMenu) { Icon(Icons.Default.Menu, "m", tint = Color(0xFF9CA3AF)) }
                IconButton(onClick = { if (webView?.canGoBack() == true) webView?.goBack() }) { Icon(Icons.Default.ArrowBack, "b", tint = Color(0xFF9CA3AF)) }
                IconButton(onClick = onHome) { Icon(Icons.Default.Home, "h", tint = Color(0xFF9CA3AF)) }
                IconButton(onClick = { if (webView?.canGoForward() == true) webView?.goForward() }) { Icon(Icons.Default.ArrowForward, "f", tint = Color(0xFF9CA3AF)) }
                IconButton(onClick = onDownloads) { Icon(Icons.Default.Download, "d", tint = Color(0xFF9CA3AF)) }
            }
        }
    }

    if (showPicker) {
        AlertDialog(
            onDismissRequest = { showPicker = false },
            title = { Text("الفيديوهات (${detected.size})") },
            text = {
                LazyColumn(Modifier.heightIn(max = 400.dp)) {
                    items(detected) { v ->
                        Card(Modifier.fillMaxWidth().padding(vertical = 4.dp).clickable {
                            downloadFile(ctx, v.url, v.title); showPicker = false
                        }, colors = CardDefaults.cardColors(containerColor = Color(0xFF1A1A24))) {
                            Column(Modifier.padding(10.dp)) {
                                Text(v.title, color = Color.White, maxLines = 2)
                                Text("الجودة: ${v.quality}", color = Color(0xFF3B82F6), fontSize = 12.sp)
                                Text(v.url.take(55), color = Color.Gray, fontSize = 10.sp, maxLines = 1)
                                Spacer(Modifier.height(6.dp))
                                Text("اضغط للتحميل ⬇", color = Color(0xFF22C55E), fontSize = 12.sp)
                            }
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { showPicker = false }) { Text("إغلاق") } },
            dismissButton = { TextButton(onClick = { detected.clear() }) { Text("مسح", color = Color(0xFFFF6B6B)) } }
        )
    }
}

const val JS = """
(function(){
  if(window.__ab)return; window.__ab=1;
  function n(u,t,q){try{window.AB&&window.AB.add(u,t||document.title,q||'')}catch(e){}}
  function scan(){
    document.querySelectorAll('video').forEach(function(v){
      var s=v.src||v.currentSrc; if(s&&!s.startsWith('data:')&&!s.startsWith('blob:')) n(s,'','');
      v.querySelectorAll('source').forEach(function(so){if(so.src&&!so.src.startsWith('data:')&&!so.src.startsWith('blob:')) n(so.src,'','')});
    });
    document.querySelectorAll('a[href]').forEach(function(a){var h=a.href;if(/\.(mp4|webm|mkv|m3u8|mov|mpd)(\?|$)/i.test(h)) n(h,'','')});
    var html=document.documentElement.innerHTML;
    var re=/https?:\/\/[^\s"'<>\)]+\.m3u8[^\s"'<>\)]*/g,m;
    while((m=re.exec(html))!==null) n(m[0],document.title,'HLS');
  }
  scan(); setInterval(scan,2500);
  try{new MutationObserver(scan).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['src']})}catch(e){}
  try{var of=window.fetch;window.fetch=function(){try{var u=arguments[0];if(typeof u==='string'&&(u.includes('.mp4')||u.includes('.m3u8')))n(u,'','')}catch(e){}return of.apply(this,arguments)}}catch(e){}
  try{var oo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){try{if(typeof u==='string'&&(u.includes('.mp4')||u.includes('.m3u8')))n(u,'','')}catch(e){}return oo.apply(this,arguments)}}catch(e){}
})();
"""

suspend fun extractTikTok(url: String): List<Vid> = withContext(Dispatchers.IO) {
    val out = mutableListOf<Vid>()
    try {
        val api = "https://www.tikwm.com/api/?url=" + URLEncoder.encode(url, "UTF-8") + "&hd=1"
        val conn = (URL(api).openConnection() as HttpURLConnection).apply { connectTimeout = 15000; readTimeout = 15000; setRequestProperty("User-Agent", "Mozilla/5.0") }
        val txt = conn.inputStream.bufferedReader().use { it.readText() }
        val j = JSONObject(txt)
        if (j.optInt("code", -1) != 0) return@withContext out
        val d = j.optJSONObject("data") ?: return@withContext out
        val title = d.optString("title", "TikTok")
        val hd = d.optString("hdplay", ""); val sd = d.optString("play", ""); val music = d.optString("music", "")
        if (hd.isNotEmpty()) out.add(Vid(if (hd.startsWith("http")) hd else "https://www.tikwm.com$hd", title, "HD"))
        if (sd.isNotEmpty()) out.add(Vid(if (sd.startsWith("http")) sd else "https://www.tikwm.com$sd", title, "SD"))
        if (music.isNotEmpty()) out.add(Vid(if (music.startsWith("http")) music else "https://www.tikwm.com$music", "$title (صوت)", "MP3"))
    } catch (_: Exception) {}
    out
}

suspend fun extractYouTube(url: String): List<Vid> = withContext(Dispatchers.IO) {
    val out = mutableListOf<Vid>()
    try {
        val id = Regex("v=([A-Za-z0-9_-]{11})").find(url)?.groupValues?.get(1)
            ?: Regex("youtu\\.be/([A-Za-z0-9_-]{11})").find(url)?.groupValues?.get(1)
            ?: return@withContext out
        val body = """{"url":"https://www.youtube.com/watch?v=$id","vQuality":"720","isAudioOnly":false}"""
        val conn = (URL("https://api.cobalt.tools/api/json").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"; connectTimeout = 25000; readTimeout = 25000; doOutput = true
            setRequestProperty("Content-Type", "application/json"); setRequestProperty("Accept", "application/json")
            outputStream.write(body.toByteArray())
        }
        if (conn.responseCode == 200) {
            val j = JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
            val u = j.optString("url", "")
            if (u.isNotEmpty()) out.add(Vid(u, "YouTube Video", "720p"))
        }
    } catch (_: Exception) {}
    out
}

@Composable
fun DownloadsScreen(onBack: () -> Unit) {
    Column(Modifier.fillMaxSize().background(Color.Black)) {
        Surface(color = Color(0xFF0D0D12)) {
            Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, "b", tint = Color.White) }
                Text("تنزيلاتي (${myDownloads.size})", color = Color.White, fontSize = 18.sp)
            }
        }
        if (myDownloads.isEmpty()) {
            Box(Modifier.fillMaxSize(), Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(Icons.Default.Download, "d", tint = Color(0xFF666666), modifier = Modifier.size(64.dp))
                    Spacer(Modifier.height(12.dp))
                    Text("لا توجد تنزيلات", color = Color.Gray, fontSize = 16.sp)
                }
            }
        } else {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(myDownloads) { d ->
                    Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF1A1A24))) {
                        Column(Modifier.padding(12.dp)) {
                            Text(d.name, color = Color.White, maxLines = 2)
                            Spacer(Modifier.height(4.dp))
                            Text("جاري التحميل...", color = Color(0xFF3B82F6), fontSize = 13.sp)
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun MenuScreen(onBack: () -> Unit, onDownloads: () -> Unit, onHistory: () -> Unit) {
    val items = listOf(
        "⬇️" to "التنزيلات", "🕘" to "السجل", "🛡️" to "منع الإعلانات", "🌙" to "الوضع الليلي",
        "⭐" to "الإشارات", "📤" to "مشاركة", "🖥️" to "سطح المكتب", "⚙️" to "الإعدادات",
        "🔍" to "بحث الصفحة", "💾" to "حفظ", "📚" to "المحفوظة", "🌍" to "ترجمة",
        "📄" to "المصدر", "⛶" to "ملء الشاشة", "🖼️" to "الصور", "📁" to "الموارد",
        "📱" to "UA", "⚡" to "سجل الشبكة", "📷" to "QR", "➕" to "للرئيسية",
        "🔊" to "قراءة", "🤖" to "AI", "🔄" to "الاتجاه", "🗑️" to "مسح البيانات",
        "📝" to "حجم النص", "✏️" to "إعلان", "🎛️" to "تخصيص", "🏠" to "الرئيسية"
    )
    Column(Modifier.fillMaxSize().background(Color.Black)) {
        Surface(color = Color(0xFF0D0D12)) {
            Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, "b", tint = Color.White) }
                Text("القائمة", color = Color.White, fontSize = 18.sp)
            }
        }
        LazyVerticalGrid(columns = GridCells.Fixed(5), modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            items(items) { pair ->
                Column(Modifier.clickable {
                    when (pair.second) { "التنزيلات" -> onDownloads(); "السجل" -> onHistory() }
                }, horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(pair.first, fontSize = 28.sp)
                    Text(pair.second, color = Color(0xFF9CA3AF), fontSize = 10.sp, textAlign = TextAlign.Center, lineHeight = 12.sp)
                }
            }
        }
    }
}

@Composable
fun HistoryScreen(onBack: () -> Unit, onSearch: (String) -> Unit) {
    val ctx = LocalContext.current
    val prefs = remember { ctx.getSharedPreferences("hist", Context.MODE_PRIVATE) }
    var items by remember { mutableStateOf(prefs.getString("l", "")?.split("\n")?.filter { it.isNotBlank() } ?: emptyList()) }
    Column(Modifier.fillMaxSize().background(Color.Black)) {
        Surface(color = Color(0xFF0D0D12)) {
            Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, "b", tint = Color.White) }
                Text("السجل (${items.size})", color = Color.White, fontSize = 18.sp)
                Spacer(Modifier.weight(1f))
                if (items.isNotEmpty()) TextButton(onClick = { prefs.edit().clear().apply(); items = emptyList() }) { Text("مسح", color = Color(0xFFFF6B6B)) }
            }
        }
        if (items.isEmpty()) {
            Box(Modifier.fillMaxSize(), Alignment.Center) { Text("لا يوجد سجل", color = Color.Gray) }
        } else {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                items(items) { q ->
                    Card(Modifier.fillMaxWidth().clickable { onSearch(q) }, colors = CardDefaults.cardColors(containerColor = Color(0xFF1A1A24))) {
                        Text(q, Modifier.padding(16.dp), color = Color.White)
                    }
                }
            }
        }
    }
}

fun downloadFile(ctx: Context, url: String, title: String) {
    try {
        val fileName = url.substringAfterLast('/').substringBefore('?').take(50).ifBlank { "video_${System.currentTimeMillis()}.mp4" }
        val req = DownloadManager.Request(Uri.parse(url)).apply {
            setTitle(fileName); setDescription(title)
            setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)
            setAllowedOverMetered(true); setAllowedOverRoaming(true)
        }
        val dm = ctx.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val id = dm.enqueue(req)
        myDownloads.add(0, Dl(id, fileName))
        Toast.makeText(ctx, "بدأ التحميل", Toast.LENGTH_SHORT).show()
    } catch (e: Exception) {
        Toast.makeText(ctx, "فشل: ${e.message}", Toast.LENGTH_LONG).show()
    }
}
