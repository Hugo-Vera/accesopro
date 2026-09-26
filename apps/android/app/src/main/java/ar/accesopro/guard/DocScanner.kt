package ar.accesopro.guard

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.platform.LocalContext
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

private fun readScaledBase64(ctx: Context, uri: Uri, maxSide: Int = 2000): String? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    ctx.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    var sample = 1
    while (bounds.outWidth / sample > maxSide * 2 || bounds.outHeight / sample > maxSide * 2) sample *= 2
    val bmp = ctx.contentResolver.openInputStream(uri)?.use {
        BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
    } ?: return null
    val scale = minOf(1f, maxSide.toFloat() / maxOf(bmp.width, bmp.height))
    val out = if (scale < 1f) {
        android.graphics.Bitmap.createScaledBitmap(bmp, (bmp.width * scale).toInt(), (bmp.height * scale).toInt(), true)
    } else bmp
    return bitmapToBase64(out)
}

/**
 * Escáner de documentos de Google (ML Kit): detecta bordes, recorta y endereza.
 * Si Play services no lo tiene disponible, [onUnavailable] abre el escáner propio (DocScanScreen).
 */
@Composable
fun rememberDocumentScanner(
    onPhoto: (String) -> Unit,
    onUnavailable: () -> Unit,
    onError: (String) -> Unit,
): () -> Unit {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val photo = rememberUpdatedState(onPhoto)
    val unavailable = rememberUpdatedState(onUnavailable)
    val error = rememberUpdatedState(onError)
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { res ->
        if (res.resultCode != Activity.RESULT_OK) return@rememberLauncherForActivityResult
        val uri = GmsDocumentScanningResult.fromActivityResultIntent(res.data)?.pages?.firstOrNull()?.imageUri
            ?: return@rememberLauncherForActivityResult
        scope.launch {
            val b64 = withContext(Dispatchers.IO) { runCatching { readScaledBase64(ctx, uri) }.getOrNull() }
            if (b64 == null) error.value("No se pudo leer la foto. Probá de nuevo.") else photo.value(b64)
        }
    }
    return launch@{
        val activity = ctx.findActivity()
        if (activity == null) {
            unavailable.value()
            return@launch
        }
        val options = GmsDocumentScannerOptions.Builder()
            .setGalleryImportAllowed(false)
            .setPageLimit(1)
            .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
            .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_BASE)
            .build()
        runCatching {
            GmsDocumentScanning.getClient(options)
                .getStartScanIntent(activity)
                .addOnSuccessListener { sender -> launcher.launch(IntentSenderRequest.Builder(sender).build()) }
                .addOnFailureListener { unavailable.value() }
        }.onFailure { unavailable.value() }
    }
}
