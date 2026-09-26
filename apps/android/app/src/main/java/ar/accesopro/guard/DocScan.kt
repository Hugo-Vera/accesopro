package ar.accesopro.guard

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Matrix
import android.util.Size
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.concurrent.Executors
import kotlin.math.abs

/** Caja normalizada (0..1) en la orientación de pantalla. */
data class DocBox(val x: Float, val y: Float, val w: Float, val h: Float, val score: Float)

private const val AUTO_CAPTURE_FRAMES = 6
private const val ANALYZE_EVERY_MS = 160L
private val SHEET_GREEN = Color(0xFF22C55E)

/**
 * Hoja clara sobre fondo más oscuro (espejo de apps/web/lib/detectDocBox.ts). No es OCR.
 * [gray] en 0..255, largo width*height.
 */
fun detectDocBox(gray: IntArray, width: Int, height: Int): DocBox? {
    val n = width * height
    val hist = IntArray(256)
    for (i in 0 until n) hist[gray[i]]++
    var sum = 0L
    for (i in 0 until 256) sum += i.toLong() * hist[i]
    var sumB = 0L
    var wB = 0L
    var maxVar = 0.0
    var thresh = 160
    for (i in 0 until 256) {
        wB += hist[i]
        if (wB == 0L) continue
        val wF = n - wB
        if (wF == 0L) break
        sumB += i.toLong() * hist[i]
        val mB = sumB.toDouble() / wB
        val mF = (sum - sumB).toDouble() / wF
        val between = wB.toDouble() * wF * (mB - mF) * (mB - mF)
        if (between > maxVar) {
            maxVar = between
            thresh = i
        }
    }
    thresh = (thresh + 6).coerceIn(125, 210)

    val seen = BooleanArray(n)
    val stack = IntArray(n)
    var best: DocBox? = null
    for (start in 0 until n) {
        if (seen[start] || gray[start] < thresh) continue
        var sp = 0
        stack[sp++] = start
        seen[start] = true
        var count = 0
        var x0 = width
        var y0 = height
        var x1 = 0
        var y1 = 0
        var innerSum = 0L
        while (sp > 0) {
            val p = stack[--sp]
            val x = p % width
            val y = p / width
            count++
            innerSum += gray[p]
            if (x < x0) x0 = x
            if (y < y0) y0 = y
            if (x > x1) x1 = x
            if (y > y1) y1 = y
            if (x > 0) { val q = p - 1; if (!seen[q] && gray[q] >= thresh) { seen[q] = true; stack[sp++] = q } }
            if (x < width - 1) { val q = p + 1; if (!seen[q] && gray[q] >= thresh) { seen[q] = true; stack[sp++] = q } }
            if (y > 0) { val q = p - width; if (!seen[q] && gray[q] >= thresh) { seen[q] = true; stack[sp++] = q } }
            if (y < height - 1) { val q = p + width; if (!seen[q] && gray[q] >= thresh) { seen[q] = true; stack[sp++] = q } }
        }
        val bw = x1 - x0 + 1
        val bh = y1 - y0 + 1
        if (bw < 24 || bh < 24) continue
        val fill = count.toFloat() / (bw * bh)
        val areaRatio = count.toFloat() / n
        val aspect = bw.toFloat() / bh
        if (fill < 0.52f || areaRatio < 0.05f || areaRatio > 0.62f) continue
        if (aspect < 0.35f || aspect > 3.2f) continue

        val pad = maxOf(4, (minOf(bw, bh) * 0.08f).toInt())
        var ringSum = 0L
        var ringN = 0
        for (y in maxOf(0, y0 - pad)..minOf(height - 1, y1 + pad)) {
            for (x in maxOf(0, x0 - pad)..minOf(width - 1, x1 + pad)) {
                if (x in x0..x1 && y in y0..y1) continue
                ringSum += gray[y * width + x]
                ringN++
            }
        }
        val innerMean = innerSum.toFloat() / count
        val ringMean = if (ringN > 0) ringSum.toFloat() / ringN else innerMean
        val contrast = innerMean - ringMean
        if (contrast < 18f) continue
        val score = fill * contrast * (1f - abs(areaRatio - 0.22f))
        if (best == null || score > best.score) {
            best = DocBox(x0.toFloat() / width, y0.toFloat() / height, bw.toFloat() / width, bh.toFloat() / height, score)
        }
    }
    return best
}

private fun lumaSample(image: ImageProxy, targetW: Int): Triple<IntArray, Int, Int> {
    val plane = image.planes[0]
    val buf = plane.buffer
    val rowStride = plane.rowStride
    val pixStride = plane.pixelStride
    val w = image.width
    val h = image.height
    val aw = targetW
    val ah = maxOf(1, aw * h / w)
    val out = IntArray(aw * ah)
    for (y in 0 until ah) {
        val row = (y * h / ah) * rowStride
        for (x in 0 until aw) {
            out[y * aw + x] = buf.get(row + (x * w / aw) * pixStride).toInt() and 0xFF
        }
    }
    return Triple(out, aw, ah)
}

private fun rotateBox(b: DocBox, degrees: Int): DocBox = when (degrees) {
    90 -> DocBox(1f - (b.y + b.h), b.x, b.h, b.w, b.score)
    180 -> DocBox(1f - (b.x + b.w), 1f - (b.y + b.h), b.w, b.h, b.score)
    270 -> DocBox(b.y, 1f - (b.x + b.w), b.h, b.w, b.score)
    else -> b
}

private fun uprightScaled(src: Bitmap, rotation: Int, maxSide: Int = 2000): Bitmap {
    val scale = minOf(1f, maxSide.toFloat() / maxOf(src.width, src.height))
    if (rotation == 0 && scale >= 1f) return src
    val m = Matrix().apply {
        if (scale < 1f) postScale(scale, scale)
        if (rotation != 0) postRotate(rotation.toFloat())
    }
    return Bitmap.createBitmap(src, 0, 0, src.width, src.height, m, true)
}

/**
 * Escáner de documentos a pantalla completa: recuadro verde cuando ve la hoja y
 * autocaptura cuando queda quieta ~1 s. Devuelve JPEG base64 derecho (máx. 2000 px).
 */
@Composable
fun DocScanScreen(
    title: String,
    onPhoto: (String) -> Unit,
    onClose: () -> Unit,
    onError: (String) -> Unit = {},
) {
    val ctx = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current
    val scope = rememberCoroutineScope()
    var granted by remember {
        mutableStateOf(ContextCompat.checkSelfPermission(ctx, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
    }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted = it }
    LaunchedEffect(Unit) { if (!granted) ask.launch(Manifest.permission.CAMERA) }

    var box by remember { mutableStateOf<DocBox?>(null) }
    var frame by remember { mutableStateOf(Size(1, 1)) }
    var steady by remember { mutableStateOf(0) }
    var capturing by remember { mutableStateOf(false) }
    var imageCapture by remember { mutableStateOf<ImageCapture?>(null) }
    var provider by remember { mutableStateOf<ProcessCameraProvider?>(null) }
    val analyzerExec = remember { Executors.newSingleThreadExecutor() }

    BackHandler { onClose() }

    fun shoot() {
        val cap = imageCapture ?: return
        if (capturing) return
        capturing = true
        cap.takePicture(ContextCompat.getMainExecutor(ctx), object : ImageCapture.OnImageCapturedCallback() {
            override fun onCaptureSuccess(image: ImageProxy) {
                scope.launch {
                    val b64 = withContext(Dispatchers.Default) {
                        runCatching {
                            val rotation = image.imageInfo.rotationDegrees
                            val bmp = image.toBitmap()
                            bitmapToBase64(uprightScaled(bmp, rotation))
                        }.getOrNull().also { image.close() }
                    }
                    if (b64 == null) {
                        capturing = false
                        steady = 0
                        onError("No se pudo leer la foto. Probá de nuevo.")
                    } else {
                        onPhoto(b64)
                    }
                }
            }

            override fun onError(exception: ImageCaptureException) {
                capturing = false
                steady = 0
                onError("No se pudo sacar la foto. Probá de nuevo.")
            }
        })
    }

    LaunchedEffect(steady) {
        if (steady >= AUTO_CAPTURE_FRAMES && !capturing) shoot()
    }

    DisposableEffect(Unit) {
        onDispose {
            runCatching { provider?.unbindAll() }
            analyzerExec.shutdown()
        }
    }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        if (granted) {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { context ->
                    val previewView = PreviewView(context).apply { scaleType = PreviewView.ScaleType.FILL_CENTER }
                    val future = ProcessCameraProvider.getInstance(context)
                    future.addListener({
                        val p = future.get()
                        provider = p
                        val preview = Preview.Builder().build().also { it.surfaceProvider = previewView.surfaceProvider }
                        val capture = ImageCapture.Builder()
                            .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                            .build()
                        val analysis = ImageAnalysis.Builder()
                            .setTargetResolution(Size(640, 480))
                            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                            .build()
                        val main = ContextCompat.getMainExecutor(context)
                        var lastAt = 0L
                        var prev: DocBox? = null
                        var run = 0
                        analysis.setAnalyzer(analyzerExec) { image ->
                            val now = System.currentTimeMillis()
                            if (now - lastAt < ANALYZE_EVERY_MS) {
                                image.close()
                                return@setAnalyzer
                            }
                            lastAt = now
                            val rotation = image.imageInfo.rotationDegrees
                            val (gray, aw, ah) = lumaSample(image, 240)
                            val fw = if (rotation % 180 == 0) image.width else image.height
                            val fh = if (rotation % 180 == 0) image.height else image.width
                            image.close()
                            val raw = detectDocBox(gray, aw, ah)?.let { rotateBox(it, rotation) }
                            // Una franja angosta (borde de puerta, cortina) no es una hoja.
                            val found = raw?.takeIf { it.w >= 0.18f && it.h >= 0.18f }
                            val last = prev
                            val still = found != null && last != null &&
                                abs(found.x - last.x) < 0.035f && abs(found.y - last.y) < 0.035f &&
                                abs(found.w - last.w) < 0.05f && abs(found.h - last.h) < 0.05f
                            run = if (still) run + 1 else if (found != null) 1 else 0
                            prev = found
                            val r = run
                            main.execute {
                                box = found
                                frame = Size(fw, fh)
                                steady = r
                            }
                        }
                        try {
                            p.unbindAll()
                            p.bindToLifecycle(lifecycle, CameraSelector.DEFAULT_BACK_CAMERA, preview, capture, analysis)
                            imageCapture = capture
                        } catch (_: Exception) {
                            onError("No se pudo abrir la cámara")
                        }
                    }, ContextCompat.getMainExecutor(context))
                    previewView
                },
            )

            Canvas(Modifier.fillMaxSize()) {
                val b = box ?: return@Canvas
                val fw = frame.width.toFloat()
                val fh = frame.height.toFloat()
                val scale = maxOf(size.width / fw, size.height / fh)
                val dispW = fw * scale
                val dispH = fh * scale
                val ox = (size.width - dispW) / 2f
                val oy = (size.height - dispH) / 2f
                val left = ox + b.x * dispW
                val top = oy + b.y * dispH
                val bw = b.w * dispW
                val bh = b.h * dispH
                drawRect(
                    color = SHEET_GREEN,
                    topLeft = Offset(left, top),
                    size = androidx.compose.ui.geometry.Size(bw, bh),
                    style = Stroke(width = 4.dp.toPx()),
                )
                val pct = (steady.toFloat() / AUTO_CAPTURE_FRAMES).coerceIn(0f, 1f)
                if (pct > 0f) {
                    drawRect(
                        color = SHEET_GREEN,
                        topLeft = Offset(left, top + bh - 6.dp.toPx()),
                        size = androidx.compose.ui.geometry.Size(bw * pct, 6.dp.toPx()),
                    )
                }
            }
        } else {
            Column(
                modifier = Modifier.fillMaxSize().padding(24.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text("Permiso de cámara requerido", color = Color.White, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(12.dp))
                Button(onClick = { ask.launch(Manifest.permission.CAMERA) }, shape = RoundedCornerShape(12.dp)) {
                    Text("Conceder permiso")
                }
            }
        }

        Surface(
            modifier = Modifier.fillMaxWidth().statusBarsPadding().padding(16.dp),
            shape = RoundedCornerShape(14.dp),
            color = MaterialTheme.colorScheme.surface.copy(alpha = 0.9f),
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.4f)),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onClose) { Icon(Icons.Default.Close, contentDescription = "Cerrar") }
                Text(
                    title,
                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                    textAlign = TextAlign.Center,
                    modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.width(48.dp))
            }
        }

        Column(
            modifier = Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Surface(
                shape = RoundedCornerShape(12.dp),
                color = MaterialTheme.colorScheme.surface.copy(alpha = 0.88f),
            ) {
                Text(
                    when {
                        capturing -> "Capturado. Procesando…"
                        box != null && steady >= 2 -> "Hoja detectada. Mantené quieto: se captura sola."
                        box != null -> "Hoja detectada."
                        else -> "Apoyá la constancia sobre un fondo oscuro. Cuando aparece el recuadro verde y queda quieta, se captura sola."
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
                )
            }
            FilledIconButton(
                onClick = { shoot() },
                enabled = granted && imageCapture != null && !capturing,
                modifier = Modifier.size(56.dp),
            ) {
                if (capturing) {
                    CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
                } else {
                    Icon(CameraIcon, contentDescription = "Capturar", modifier = Modifier.size(24.dp))
                }
            }
        }
    }
}
