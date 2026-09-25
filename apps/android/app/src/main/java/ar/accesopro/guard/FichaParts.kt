package ar.accesopro.guard

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/** Espejo de docRequirements() de la API (apps/api/src/visitHold.ts). */
data class DocReq(val art: Boolean, val vehicle: Boolean, val license: Boolean, val trunk: Boolean)

fun docRequirements(visitKind: String?, arrivalMode: String?): DocReq {
    val vehicle = arrivalMode == "vehiculo"
    return DocReq(
        art = visitKind == "contractor" || visitKind == "service",
        vehicle = vehicle,
        license = vehicle,
        trunk = vehicle,
    )
}

val VISIT_KINDS = listOf(
    "social" to "Social",
    "service" to "Servicio / técnico",
    "contractor" to "Contratista",
    "delivery" to "Delivery",
)

val ARRIVAL_MODES = listOf(
    "peatonal" to "A pie",
    "vehiculo" to "Vehículo",
)

fun visitKindLabel(k: String?) = VISIT_KINDS.firstOrNull { it.first == k }?.second ?: "Social"
fun arrivalModeLabel(m: String?) = ARRIVAL_MODES.firstOrNull { it.first == m }?.second ?: "A pie"

fun artLabelFor(visitKind: String?) = if (visitKind == "service") "ART o seguro de vida" else "ART"

/** Etiqueta legible y página de la ficha para cada faltante/vencido de la API. */
fun missingInfo(key: String, sentido: String = "in"): Pair<String, String> = when (key) {
    "dni" -> "Falta DNI" to "identity"
    "patente" -> "Falta patente" to "vehicle"
    "seguro_vehiculo" -> "Falta seguro del auto" to "vehicle"
    "seguro_foto" -> "Falta foto de la tarjeta del seguro" to "vehicle"
    "licencia" -> "Falta licencia de conducir" to "vehicle"
    "licencia_foto" -> "Falta foto de la licencia" to "vehicle"
    "art" -> "Falta ART / seguro de vida" to "art"
    "art_constancia" -> "Falta foto de la constancia de ART" to "art"
    "baul" -> "Falta revisar el baúl (descripción o foto)" to if (sentido == "out") "exit" else "vehicle"
    "seguro_vehiculo_vencido" -> "Seguro del auto vencido" to "vehicle"
    "licencia_vencida" -> "Licencia vencida" to "vehicle"
    "art_vencido" -> "ART vencida" to "art"
    else -> key.replace('_', ' ') to "summary"
}

fun expiredLabel(key: String) = when (key) {
    "seguro_vehiculo" -> "Seguro del auto vencido"
    "licencia" -> "Licencia vencida"
    "art" -> "ART vencida"
    else -> "$key vencido"
}

/** AAAA-MM-DD a dd/mm/aaaa. */
fun fmtDate(iso: String?): String {
    if (iso.isNullOrBlank()) return "—"
    val d = iso.take(10)
    val parts = d.split("-")
    return if (parts.size == 3) "${parts[2]}/${parts[1]}/${parts[0]}" else d
}

fun fmtDateTime(iso: String?): String {
    if (iso.isNullOrBlank()) return "—"
    return runCatching {
        val src = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
        val date = src.parse(iso.take(19)) ?: return fmtDate(iso)
        SimpleDateFormat("dd/MM HH:mm", Locale.getDefault()).format(date)
    }.getOrElse { fmtDate(iso) }
}

fun isPastDate(iso: String): Boolean {
    if (iso.length < 10) return false
    val today = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
    return iso.take(10) < today
}

val CameraIcon: ImageVector by lazy {
    ImageVector.Builder(
        name = "Camera",
        defaultWidth = 24.dp,
        defaultHeight = 24.dp,
        viewportWidth = 24f,
        viewportHeight = 24f,
    ).addPath(
        pathData = addPathNodes(
            "M12,12m-3.2,0a3.2,3.2 0,1 1,6.4 0a3.2,3.2 0,1 1,-6.4 0" +
                "M9,2L7.17,4H4c-1.1,0 -2,0.9 -2,2v12c0,1.1 0.9,2 2,2h16c1.1,0 2,-0.9 2,-2V6c0,-1.1 -0.9,-2 -2,-2h-3.17L15,2H9z" +
                "M12,17c-2.76,0 -5,-2.24 -5,-5s2.24,-5 5,-5 5,2.24 5,5 -2.24,5 -5,5z",
        ),
        fill = SolidColor(Color.Black),
    ).build()
}

@Composable
fun SectionTitle(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold, letterSpacing = 1.2.sp),
        color = MaterialTheme.colorScheme.primary,
    )
}

@Composable
fun ChoiceGrid(
    options: List<Pair<String, String>>,
    selected: String?,
    enabled: Boolean = true,
    onSelect: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        options.chunked(2).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                row.forEach { (key, label) ->
                    val on = key == selected
                    FilterChip(
                        selected = on,
                        enabled = enabled,
                        onClick = { onSelect(key) },
                        label = {
                            Text(
                                label,
                                fontWeight = if (on) FontWeight.Bold else FontWeight.Medium,
                                modifier = Modifier.fillMaxWidth(),
                            )
                        },
                        modifier = Modifier.weight(1f).height(44.dp),
                    )
                }
                if (row.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DateField(label: String, value: String, onChange: (String) -> Unit, enabled: Boolean = true) {
    var open by remember { mutableStateOf(false) }
    val expired = value.isNotBlank() && isPastDate(value)
    OutlinedButton(
        onClick = { open = true },
        enabled = enabled,
        modifier = Modifier.fillMaxWidth().height(52.dp),
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(
            1.dp,
            if (expired) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.outline,
        ),
    ) {
        Icon(Icons.Default.DateRange, contentDescription = null, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(8.dp))
        Text(
            if (value.isBlank()) label else "$label: ${fmtDate(value)}${if (expired) " (vencida)" else ""}",
            color = if (expired) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.weight(1f),
        )
    }
    if (open) {
        val initial = runCatching {
            SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
                .parse(value)?.time
        }.getOrNull()
        val state = rememberDatePickerState(initialSelectedDateMillis = initial)
        DatePickerDialog(
            onDismissRequest = { open = false },
            confirmButton = {
                TextButton(onClick = {
                    state.selectedDateMillis?.let { ms ->
                        val f = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
                        onChange(f.format(Date(ms)))
                    }
                    open = false
                }) { Text("Listo") }
            },
            dismissButton = { TextButton(onClick = { open = false }) { Text("Cancelar") } },
        ) {
            DatePicker(state = state, title = { Text(label, modifier = Modifier.padding(16.dp)) })
        }
    }
}

private fun decodeScaled(file: File, maxSide: Int = 2000): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.absolutePath, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    var sample = 1
    while (bounds.outWidth / sample > maxSide * 2 || bounds.outHeight / sample > maxSide * 2) sample *= 2
    val bmp = BitmapFactory.decodeFile(file.absolutePath, BitmapFactory.Options().apply { inSampleSize = sample })
        ?: return null
    val rotation = runCatching {
        when (ExifInterface(file.absolutePath).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
            ExifInterface.ORIENTATION_ROTATE_90 -> 90f
            ExifInterface.ORIENTATION_ROTATE_180 -> 180f
            ExifInterface.ORIENTATION_ROTATE_270 -> 270f
            else -> 0f
        }
    }.getOrDefault(0f)
    val scale = minOf(1f, maxSide.toFloat() / maxOf(bmp.width, bmp.height))
    if (rotation == 0f && scale >= 1f) return bmp
    val m = Matrix().apply {
        if (scale < 1f) postScale(scale, scale)
        if (rotation != 0f) postRotate(rotation)
    }
    return Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
}

fun bitmapToBase64(bmp: Bitmap, quality: Int = 85): String {
    val out = ByteArrayOutputStream()
    bmp.compress(Bitmap.CompressFormat.JPEG, quality, out)
    return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
}

fun base64ToImage(b64: String): ImageBitmap? = runCatching {
    val bytes = Base64.decode(b64, Base64.DEFAULT)
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
}.getOrNull()

private fun newCameraUri(ctx: Context): Pair<File, Uri> {
    val dir = File(ctx.cacheDir, "camera").apply { mkdirs() }
    val file = File(dir, "cap-${System.currentTimeMillis()}.jpg")
    val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.fileprovider", file)
    return file to uri
}

/**
 * Cámara a resolución completa (TakePicture + FileProvider). Devuelve JPEG base64 ya rotado y
 * achicado a 2000 px de lado; onError si la foto no se pudo leer.
 */
@Composable
fun rememberFullCamera(onPhoto: (String) -> Unit, onError: (String) -> Unit = {}): () -> Unit {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var pending by remember { mutableStateOf<File?>(null) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val file = pending
        pending = null
        if (!ok || file == null) return@rememberLauncherForActivityResult
        scope.launch {
            val b64 = withContext(Dispatchers.Default) {
                runCatching { decodeScaled(file)?.let { bitmapToBase64(it) } }.getOrNull()
            }
            file.delete()
            if (b64 == null) onError("No se pudo leer la foto. Probá de nuevo.") else onPhoto(b64)
        }
    }
    return {
        runCatching {
            val (file, uri) = newCameraUri(ctx)
            pending = file
            launcher.launch(uri)
        }.onFailure { onError("No se pudo abrir la cámara") }
    }
}

/** Botón de foto de documento con vista previa. La API recorta bordes al guardar. */
@Composable
fun DocPhotoButton(
    label: String,
    photo: String?,
    onServer: Boolean,
    enabled: Boolean,
    onShoot: () -> Unit,
    onClear: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(
            onClick = onShoot,
            enabled = enabled,
            modifier = Modifier.fillMaxWidth().height(48.dp),
            shape = RoundedCornerShape(12.dp),
        ) {
            Icon(CameraIcon, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text(
                when {
                    photo != null -> "Repetir foto: $label"
                    onServer -> "$label cargada · Reemplazar"
                    else -> "Fotografiar $label"
                },
            )
        }
        val img = remember(photo) { photo?.let { base64ToImage(it) } }
        if (img != null) {
            Box {
                Image(
                    bitmap = img,
                    contentDescription = label,
                    contentScale = ContentScale.Fit,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = 220.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(MaterialTheme.colorScheme.surfaceVariant),
                )
                IconButton(onClick = onClear, modifier = Modifier.align(Alignment.TopEnd)) {
                    Icon(Icons.Default.Close, contentDescription = "Quitar foto")
                }
            }
        }
    }
}

/** Documento ya guardado de una visita anterior: "Usar" lo vincula sin volver a cargarlo. */
@Composable
fun DocOnFileCard(
    title: String,
    doc: DocInfo,
    using: Boolean,
    enabled: Boolean,
    onUse: () -> Unit,
    onNew: () -> Unit,
) {
    val color = when {
        doc.expired -> MaterialTheme.colorScheme.errorContainer
        using -> MaterialTheme.colorScheme.primaryContainer
        else -> MaterialTheme.colorScheme.secondaryContainer
    }
    val onColor = when {
        doc.expired -> MaterialTheme.colorScheme.onErrorContainer
        using -> MaterialTheme.colorScheme.onPrimaryContainer
        else -> MaterialTheme.colorScheme.onSecondaryContainer
    }
    Surface(color = color, shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("En archivo · $title", fontWeight = FontWeight.Bold, color = onColor)
            Text(
                listOfNotNull(
                    doc.company,
                    doc.policyNumber?.let { "póliza $it" },
                    doc.licenseNumber?.let { "N° $it" },
                    doc.plate,
                    "vence ${fmtDate(doc.validUntil)}",
                    if (doc.hasDocument) "con foto" else "sin foto",
                ).joinToString(" · "),
                color = onColor,
                style = MaterialTheme.typography.bodyMedium,
            )
            if (doc.expired) {
                Text("Vencido: no sirve para ingresar. Cargá uno vigente.", color = onColor, fontWeight = FontWeight.Bold)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (!doc.expired) {
                    Button(onClick = onUse, enabled = enabled && !using, shape = RoundedCornerShape(10.dp)) {
                        Text(if (using) "Se usa este" else "Usar")
                    }
                }
                OutlinedButton(onClick = onNew, enabled = enabled, shape = RoundedCornerShape(10.dp)) {
                    Text("Cargar otro")
                }
            }
        }
    }
}

/** Documento vinculado al pase. */
@Composable
fun DocLinkedRow(title: String, doc: DocInfo, onReplace: () -> Unit, enabled: Boolean) {
    val bad = doc.expired
    Surface(
        color = if (bad) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.surfaceVariant,
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            if (bad) {
                Icon(Icons.Default.Warning, contentDescription = null, tint = MaterialTheme.colorScheme.onErrorContainer)
                Spacer(Modifier.width(8.dp))
            }
            Column(Modifier.weight(1f)) {
                Text(
                    "$title${if (bad) " · VENCIDO" else " vinculado"}",
                    fontWeight = FontWeight.Bold,
                    color = if (bad) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.onSurface,
                )
                Text(
                    listOfNotNull(
                        doc.company,
                        doc.policyNumber?.let { "póliza $it" },
                        doc.licenseNumber?.let { "N° $it" },
                        "vence ${fmtDate(doc.validUntil)}",
                        if (doc.hasDocument) "con foto" else "falta foto",
                    ).joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall,
                    color = if (bad) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            TextButton(onClick = onReplace, enabled = enabled) { Text("Cambiar") }
        }
    }
}

private object ImageCache {
    val map = mutableMapOf<String, ImageBitmap>()
}

@Composable
fun RemoteImage(api: GuardApi?, path: String, modifier: Modifier, contentScale: ContentScale = ContentScale.Crop) {
    var img by remember(path) { mutableStateOf(ImageCache.map[path]) }
    var failed by remember(path) { mutableStateOf(false) }
    LaunchedEffect(path, api) {
        if (img != null || api == null) return@LaunchedEffect
        runCatching {
            val bytes = api.fetchImage(path)
            withContext(Dispatchers.Default) { BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap() }
        }.onSuccess { b ->
            if (b != null) {
                ImageCache.map[path] = b
                img = b
            } else failed = true
        }.onFailure { failed = true }
    }
    Box(modifier.background(MaterialTheme.colorScheme.surfaceVariant), contentAlignment = Alignment.Center) {
        val b = img
        when {
            b != null -> Image(b, contentDescription = null, contentScale = contentScale, modifier = Modifier.fillMaxSize())
            failed -> Text("Sin foto", style = MaterialTheme.typography.bodySmall)
            else -> CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
        }
    }
}

@Composable
fun FullscreenGallery(api: GuardApi?, urls: List<String>, start: Int, title: String, onClose: () -> Unit) {
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(color = Color.Black, modifier = Modifier.fillMaxSize()) {
            val pager = rememberPagerState(initialPage = start.coerceIn(0, (urls.size - 1).coerceAtLeast(0))) { urls.size }
            Box(Modifier.fillMaxSize()) {
                HorizontalPager(state = pager, modifier = Modifier.fillMaxSize()) { i ->
                    RemoteImage(api, urls[i], Modifier.fillMaxSize(), ContentScale.Fit)
                }
                Row(
                    Modifier
                        .fillMaxWidth()
                        .statusBarsPadding()
                        .padding(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "$title · ${pager.currentPage + 1} / ${urls.size}",
                        color = Color.White,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.weight(1f).padding(start = 8.dp),
                    )
                    IconButton(onClick = onClose) {
                        Icon(Icons.Default.Close, contentDescription = "Cerrar", tint = Color.White)
                    }
                }
            }
        }
    }
}

/** Revisión de baúl guardada (ingreso o salida): descripción, hora, guardia y fotos. */
@Composable
fun TrunkSavedCard(api: GuardApi?, title: String, check: TrunkCheck, highlight: Boolean = false) {
    var openAt by remember { mutableStateOf<Int?>(null) }
    Surface(
        color = if (highlight) MaterialTheme.colorScheme.tertiaryContainer else MaterialTheme.colorScheme.surfaceVariant,
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, fontWeight = FontWeight.Bold)
            Text(
                listOfNotNull(fmtDateTime(check.at), check.guardName).joinToString(" · "),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(check.description ?: "Sin descripción", style = MaterialTheme.typography.bodyMedium)
            if (check.photoUrls.isNotEmpty()) {
                Row(
                    Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    check.photoUrls.forEachIndexed { i, url ->
                        RemoteImage(
                            api,
                            url,
                            Modifier
                                .size(110.dp)
                                .clip(RoundedCornerShape(10.dp))
                                .clickable { openAt = i },
                        )
                    }
                }
            } else {
                Text("Sin fotos", style = MaterialTheme.typography.bodySmall)
            }
        }
    }
    openAt?.let { i -> FullscreenGallery(api, check.photoUrls, i, title) { openAt = null } }
}

/** Estado local del baúl antes de subirlo con "Guardar y siguiente". */
class TrunkDraft(initial: TrunkCheck?) {
    var description by mutableStateOf(initial?.description ?: "")
    val newPhotos = mutableStateListOf<String>()
    val removed = mutableStateListOf<String>()
    private val initialDescription = initial?.description ?: ""

    fun dirty() = description.trim() != initialDescription.trim() || newPhotos.isNotEmpty() || removed.isNotEmpty()
}

@Composable
fun TrunkEditor(
    api: GuardApi?,
    saved: TrunkCheck?,
    draft: TrunkDraft,
    label: String,
    enabled: Boolean,
    onError: (String) -> Unit,
) {
    val shoot = rememberFullCamera(onPhoto = { draft.newPhotos.add(it) }, onError = onError)
    var openAt by remember { mutableStateOf<Int?>(null) }
    val keptUrls = saved?.photoIds?.zip(saved.photoUrls)?.filter { it.first !in draft.removed } ?: emptyList()
    val total = keptUrls.size + draft.newPhotos.size
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
                value = draft.description,
                onValueChange = { draft.description = it.take(500) },
                label = { Text(label) },
                enabled = enabled,
                modifier = Modifier.weight(1f),
                shape = RoundedCornerShape(12.dp),
                minLines = 2,
            )
            FilledTonalIconButton(
                onClick = shoot,
                enabled = enabled && total < 6,
                modifier = Modifier.size(56.dp),
            ) {
                Icon(CameraIcon, contentDescription = "Sacar foto del baúl")
            }
        }
        if (total > 0) {
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                keptUrls.forEachIndexed { i, (pid, url) ->
                    Box {
                        RemoteImage(
                            api,
                            url,
                            Modifier
                                .size(96.dp)
                                .clip(RoundedCornerShape(10.dp))
                                .clickable { openAt = i },
                        )
                        IconButton(
                            onClick = { draft.removed.add(pid) },
                            enabled = enabled,
                            modifier = Modifier.align(Alignment.TopEnd).size(32.dp),
                        ) {
                            Icon(Icons.Default.Delete, contentDescription = "Borrar foto", tint = Color.White)
                        }
                    }
                }
                draft.newPhotos.forEachIndexed { i, b64 ->
                    val img = remember(b64) { base64ToImage(b64) }
                    Box {
                        if (img != null) {
                            Image(
                                img,
                                contentDescription = null,
                                contentScale = ContentScale.Crop,
                                modifier = Modifier.size(96.dp).clip(RoundedCornerShape(10.dp)),
                            )
                        }
                        IconButton(
                            onClick = { draft.newPhotos.removeAt(i) },
                            enabled = enabled,
                            modifier = Modifier.align(Alignment.TopEnd).size(32.dp),
                        ) {
                            Icon(Icons.Default.Delete, contentDescription = "Borrar foto", tint = Color.White)
                        }
                    }
                }
            }
            Text(
                "$total de 6 fotos${if (draft.newPhotos.isNotEmpty()) " · se suben al guardar" else ""}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
    openAt?.let { i -> FullscreenGallery(api, keptUrls.map { it.second }, i, label) { openAt = null } }
}

@Composable
fun GoodsAlertDialog(
    busy: Boolean,
    onDismiss: () -> Unit,
    onSend: (String, String?) -> Unit,
    onError: (String) -> Unit,
) {
    var description by remember { mutableStateOf("") }
    var photo by remember { mutableStateOf<String?>(null) }
    val shoot = rememberFullCamera(onPhoto = { photo = it }, onError = onError)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Bien no registrado") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Se avisa al lote y la barrera queda retenida hasta que autorice.")
                OutlinedTextField(
                    value = description,
                    onValueChange = { description = it.take(300) },
                    label = { Text("Qué lleva") },
                    modifier = Modifier.fillMaxWidth(),
                )
                DocPhotoButton("foto del bien", photo, false, !busy, shoot) { photo = null }
            }
        },
        confirmButton = {
            TextButton(onClick = { onSend(description, photo) }, enabled = !busy && description.isNotBlank()) {
                Text("Avisar al lote")
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancelar") } },
    )
}
