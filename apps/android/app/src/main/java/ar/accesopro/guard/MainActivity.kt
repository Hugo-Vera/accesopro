package ar.accesopro.guard

import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AccountBox
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.ExitToApp
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import android.graphics.Bitmap
import android.graphics.Color as AndroidColor
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private fun qrBitmap(payload: String, size: Int = 512): Bitmap? {
    return runCatching {
        val hints = mapOf(EncodeHintType.MARGIN to 1)
        val matrix = QRCodeWriter().encode(payload, BarcodeFormat.QR_CODE, size, size, hints)
        Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888).also { bmp ->
            for (x in 0 until size) {
                for (y in 0 until size) {
                    bmp.setPixel(x, y, if (matrix[x, y]) AndroidColor.BLACK else AndroidColor.WHITE)
                }
            }
        }
    }.getOrNull()
}

/** Tras el check-in: el visitante le saca foto al QR con su celular y lo presenta en el lector. */
@Composable
private fun VisitQrDialog(payload: String, guestName: String, approved: Boolean, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (approved) "Visita aprobada" else "QR de la visita", fontWeight = FontWeight.Bold) },
        text = {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(
                    if (approved) "La barrera se abrió. Si quiere, que le saque foto al QR: con eso o con el DNI se identifica en la salida."
                    else "Mostrale la pantalla al visitante para que le saque una foto. Con ese QR se identifica en el lector de entrada y de salida; vos aprobás.",
                    style = MaterialTheme.typography.bodyMedium,
                )
                Surface(color = Color.White, shape = RoundedCornerShape(12.dp)) {
                    AccessQrImage(payload, Modifier.padding(10.dp).size(260.dp))
                }
                if (guestName.isNotBlank()) Text(guestName, fontWeight = FontWeight.Bold)
            }
        },
        confirmButton = {
            Button(onClick = onDismiss, shape = RoundedCornerShape(12.dp)) { Text(if (approved) "Listo" else "Listo, ir a la ficha") }
        },
    )
}

/** Carga manual cuando el QR o el PDF417 no se leen: con el DNI se busca el pase; si no hay, sigue como visita nueva. */
@Composable
private fun ManualEntryDialog(onDismiss: () -> Unit, onSubmit: (ParsedDni) -> Unit) {
    var dni by remember { mutableStateOf("") }
    var lastName by remember { mutableStateOf("") }
    var firstName by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Carga manual", fontWeight = FontWeight.Bold) },
        text = {
            Column(
                modifier = Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(
                    "Si el QR o el DNI no se leen. Con el DNI buscamos si tiene pase; si no, se carga como visita nueva.",
                    style = MaterialTheme.typography.bodyMedium,
                )
                OutlinedTextField(
                    value = dni,
                    onValueChange = { dni = it.filter { ch -> ch.isDigit() }.take(9) },
                    label = { Text("DNI") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Next),
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = lastName,
                    onValueChange = { lastName = it.uppercase() },
                    label = { Text("Apellido") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = firstName,
                    onValueChange = { firstName = it.uppercase() },
                    label = { Text("Nombres") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            Button(
                onClick = { onSubmit(ParsedDni(dni, firstName.trim(), lastName.trim(), "", "", "")) },
                enabled = dni.length >= 7,
                shape = RoundedCornerShape(12.dp),
            ) { Text("Buscar") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancelar") } },
    )
}

@Composable
private fun AccessQrImage(payload: String, modifier: Modifier = Modifier) {
    val bmp = remember(payload) { qrBitmap(payload, 512) }
    if (bmp != null) {
        androidx.compose.foundation.Image(
            bitmap = bmp.asImageBitmap(),
            contentDescription = "Mi QR de acceso",
            modifier = modifier,
        )
    }
}

@Composable
internal fun LaneChip(out: Boolean, compact: Boolean = false) {
    Surface(
        shape = RoundedCornerShape(6.dp),
        color = laneFill(out),
    ) {
        Text(
            text = if (out) "SALIDA" else "ENTRADA",
            style = MaterialTheme.typography.labelSmall.copy(
                fontWeight = FontWeight.Bold,
                letterSpacing = 1.2.sp,
                fontSize = if (compact) 10.sp else 11.sp,
            ),
            color = laneInk(out),
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
        )
    }
}

private fun pingGuard(ctx: Context) {
    runCatching {
        val tgClass = Class.forName("android.media.ToneGenerator")
        val constructor = tgClass.getConstructor(Int::class.javaPrimitiveType, Int::class.javaPrimitiveType)
        val toneField = tgClass.getField("TONE_CDMA_ALERT_CALL_GUARD")
        val toneVal = toneField.getInt(null)
        val tg = constructor.newInstance(AudioManager.STREAM_NOTIFICATION, 90)
        val startToneMethod = tgClass.getMethod("startTone", Int::class.javaPrimitiveType, Int::class.javaPrimitiveType)
        startToneMethod.invoke(tg, toneVal, 450)
        val releaseMethod = tgClass.getMethod("release")
        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
            runCatching { releaseMethod.invoke(tg) }
        }, 700)
    }
    runCatching {
        val pattern = longArrayOf(0, 140, 90, 140)
        if (Build.VERSION.SDK_INT >= 31) {
            val vm = ctx.getSystemService(VibratorManager::class.java)
            vm?.defaultVibrator?.vibrate(VibrationEffect.createWaveform(pattern, -1))
        } else {
            @Suppress("DEPRECATION")
            val v = ctx.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            if (Build.VERSION.SDK_INT >= 26) {
                v.vibrate(VibrationEffect.createWaveform(pattern, -1))
            } else {
                @Suppress("DEPRECATION")
                v.vibrate(320)
            }
        }
    }
}

private fun foldPersonName(raw: String): String {
    val n = java.text.Normalizer.normalize(raw, java.text.Normalizer.Form.NFD)
    return n.replace("\\p{M}+".toRegex(), "")
        .lowercase()
        .replace("[^a-z0-9\\s]".toRegex(), " ")
        .replace("\\s+".toRegex(), " ")
        .trim()
}

internal fun dniIdentityMatches(parsed: ParsedDni, guestDni: String, guestName: String): Boolean {
    val dniOk = parsed.dni.filter { it.isDigit() } == guestDni.filter { it.isDigit() } && parsed.dni.isNotBlank()
    if (!dniOk) return false
    val expected = foldPersonName(guestName)
    val a = foldPersonName(parsed.fullName())
    val b = foldPersonName("${parsed.firstName} ${parsed.lastName}")
    if (expected.isBlank() || a.isBlank()) return dniOk && expected.isBlank()
    if (expected == a || expected == b) return true
    val last = foldPersonName(parsed.lastName)
    val first = foldPersonName(parsed.firstName)
    return last.isNotBlank() && first.isNotBlank() && expected.contains(last) && expected.contains(first)
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val prefs = getSharedPreferences("guard", MODE_PRIVATE)
        setContent {
            GuardTheme {
                // Con enableEdgeToEdge el adjustResize ya no achica la ventana: el teclado tapaba los inputs.
                // imePadding en la raíz achica toda la app y Scaffold/NavigationBar descuentan el inset consumido.
                Surface(modifier = Modifier.fillMaxSize()) {
                    Box(Modifier.fillMaxSize().imePadding()) {
                        GuardApp(prefs)
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GuardApp(prefs: android.content.SharedPreferences) {
    var token by remember { mutableStateOf(prefs.getString("token", "") ?: "") }
    var role by remember { mutableStateOf(prefs.getString("role", "guard") ?: "guard") }
    var userName by remember { mutableStateOf(prefs.getString("userName", "") ?: "") }
    var baseUrl by remember { mutableStateOf(prefs.getString("baseUrl", "http://192.168.190.114:8787") ?: "") }
    var cloudUrl by remember { mutableStateOf(prefs.getString("cloudUrl", "") ?: "") }
    var email by remember { mutableStateOf("guardia@lasacacias.local") }
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var isLoading by remember { mutableStateOf(false) }
    var items by remember { mutableStateOf(listOf<ApprovalItem>()) }
    var selected by remember { mutableStateOf<ApprovalItem?>(null) }
    var census by remember { mutableStateOf<CensusSnapshot?>(null) }
    var scanOpen by remember { mutableStateOf(false) }
    var pendingScan by remember { mutableStateOf<String?>(null) }
    var pendingManual by remember { mutableStateOf<ParsedDni?>(null) }
    var manualOpen by remember { mutableStateOf(false) }
    var pendingParsedDni by remember { mutableStateOf<ParsedDni?>(null) }
    var pendingScanRaw by remember { mutableStateOf<String?>(null) }
    var visitQr by remember { mutableStateOf<Pair<String, String>?>(null) }
    var visitQrApproved by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<String?>(null) }
    var mainTab by remember { mutableStateOf("cola") }
    var capabilities by remember {
        mutableStateOf(prefs.getStringSet("capabilities", emptySet())?.toList() ?: emptyList())
    }
    val canCensus = capabilities.contains("ops.census")
    val canSos = capabilities.contains("ops.alarms")
    val scope = rememberCoroutineScope()
    val api = remember(baseUrl, cloudUrl, token) { GuardApi(baseUrl, cloudUrl, token) }

    val isPreview = LocalInspectionMode.current
    val ctx = LocalContext.current
    var knownIds by remember { mutableStateOf<Set<String>?>(null) }
    val selectedNow = rememberUpdatedState(selected)
    val tabNow = rememberUpdatedState(mainTab)

    LaunchedEffect(token, role) {
        knownIds = null
        if (token.isBlank() || isPreview || role == "resident") return@LaunchedEffect
        var rulesAt = 0L
        while (true) {
            if (System.currentTimeMillis() - rulesAt > 60_000) {
                runCatching { api.fetchEntryRules() }.onSuccess { rulesAt = System.currentTimeMillis() }
            }
            runCatching {
                val next = api.listApprovals()
                val ids = next.map { it.id }.toSet()
                val prev = knownIds
                knownIds = ids
                val fresh = if (prev == null) emptyList() else next.filter { it.id !in prev }
                items = next
                val cur = selectedNow.value
                if (cur != null) {
                    selected = next.find { it.id == cur.id } ?: cur
                }
                if (fresh.isNotEmpty()) {
                    pingGuard(ctx)
                    if (selectedNow.value == null && tabNow.value == "cola") selected = fresh.first()
                }
            }
            delay(1000)
        }
    }

    if (token.isBlank()) {
        LoginScreen(
            baseUrl = baseUrl,
            onBaseUrlChange = { baseUrl = it },
            cloudUrl = cloudUrl,
            onCloudUrlChange = { cloudUrl = it },
            email = email,
            onEmailChange = { email = it },
            password = password,
            onPasswordChange = { password = it },
            error = error,
            isLoading = isLoading,
            onLogin = {
                scope.launch {
                    isLoading = true
                    error = null
                    runCatching {
                        val session = api.login(email, password)
                        prefs.edit()
                            .putString("token", session.token)
                            .putString("role", session.role)
                            .putString("userName", session.name)
                            .putString("baseUrl", baseUrl)
                            .putString("cloudUrl", cloudUrl)
                            .putStringSet("capabilities", session.capabilities.toSet())
                            .apply()
                        role = session.role
                        userName = session.name
                        token = session.token
                        capabilities = session.capabilities
                        val fcm = prefs.getString("fcmToken", "") ?: ""
                        if (fcm.isNotBlank()) {
                            runCatching {
                                GuardApi(baseUrl, cloudUrl, session.token).registerPush(fcm)
                            }
                        }
                    }.onFailure {
                        error = it.message ?: "Error de conexión o credenciales inválidas"
                    }
                    isLoading = false
                }
            }
        )
        return
    }

    // Pantallas por estado, sin NavHost: sin esto el Atrás del sistema cierra la app.
    // Las pantallas hijas registran su BackHandler después y tienen prioridad (pasos internos).
    val backAction: (() -> Unit)? = when {
        scanOpen -> { { scanOpen = false } }
        pendingScan != null || pendingManual != null -> { { pendingScan = null; pendingManual = null } }
        pendingParsedDni != null -> { { pendingParsedDni = null; pendingScanRaw = null; error = null } }
        role != "resident" && selected != null -> { { selected = null; error = null } }
        role != "resident" && mainTab != "cola" -> { { mainTab = "cola" } }
        else -> null
    }
    BackHandler(enabled = backAction != null) { backAction?.invoke() }

    visitQr?.let { (payload, guest) ->
        VisitQrDialog(payload = payload, guestName = guest, approved = visitQrApproved, onDismiss = { visitQr = null })
    }
    if (manualOpen) {
        ManualEntryDialog(
            onDismiss = { manualOpen = false },
            onSubmit = { manual ->
                manualOpen = false
                pendingManual = manual
            },
        )
    }
    LaunchedEffect(notice) {
        if (notice != null) {
            delay(5000)
            notice = null
        }
    }

    val current = selected
    if (scanOpen) {
        BarcodeScanScreen(
            title = "QR de visita o DNI",
            onClose = { scanOpen = false },
            onResult = { raw ->
                scanOpen = false
                pendingScan = raw
            },
        )
        return
    }
    val manualNow = pendingManual
    val pendingRaw = pendingScan ?: manualNow?.dni
    if (pendingRaw != null) {
        LaunchedEffect(pendingRaw, manualNow) {
            isLoading = true
            error = null
            runCatching {
                val parsed = manualNow ?: runCatching { api.parseDni(pendingRaw) }.getOrNull()
                when (val result = api.scanQr(pendingRaw)) {
                    is ScanQrResult.Visit -> {
                        items = api.listApprovals()
                        selected = items.find { it.id == result.item.id } ?: result.item
                    }
                    is ScanQrResult.AccessOpened -> {
                        error =
                            "Acceso propio: ${result.personName}. ${if (result.actuatorsFired.isNotEmpty()) "Barrera abierta." else "Relé disparado."}"
                    }
                    is ScanQrResult.Denied -> {
                        if (parsed != null) {
                            pendingParsedDni = parsed
                            pendingScanRaw = if (manualNow == null) pendingRaw else null
                            error = null
                        } else {
                            error = result.message
                        }
                    }
                }
            }.onFailure { error = it.message }
            pendingScan = null
            pendingManual = null
            isLoading = false
        }
        IdentifyingScanScreen(onCancel = { pendingScan = null; pendingManual = null })
        return
    }
    val parsedPending = pendingParsedDni
    if (parsedPending != null) {
        NewVisitScreen(
            initial = parsedPending,
            api = api,
            rawPdf417 = pendingScanRaw,
            onDone = { outcome ->
                val result = outcome.result
                visitQrApproved = outcome.approved
                if (!result.qrPayload.isNullOrBlank()) {
                    visitQr = result.qrPayload to outcome.guestName
                }
                pendingParsedDni = null
                pendingScanRaw = null
                error = null
                scope.launch {
                    isLoading = true
                    runCatching {
                        items = api.listApprovals()
                        if (outcome.approved) {
                            notice = if (outcome.barrierOpened) {
                                "Pasó ${outcome.guestName} · lote ${outcome.lotNumber}"
                            } else {
                                "Ingreso registrado sin abrir barrera · ${outcome.guestName} · lote ${outcome.lotNumber}"
                            }
                        } else {
                            selected = items.find { it.id == result.approvalId }
                                ?: items.find { it.passId == result.passId }
                            error = outcome.message
                        }
                    }.onFailure { error = it.message }
                    isLoading = false
                }
            },
            onBack = {
                pendingParsedDni = null
                pendingScanRaw = null
                error = null
            },
        )
        return
    }
    if (role == "resident") {
        ResidentHome(
            name = userName,
            api = api,
            error = error,
            onLogout = {
                prefs.edit().remove("token").remove("role").remove("capabilities").apply()
                token = ""
            },
            onError = { error = it },
        )
        return
    }
    if (current != null) {
        ApprovalDetail(
            item = current,
            api = api,
            error = error,
            busy = isLoading,
            onBack = { selected = null; error = null },
            onPhoneAuth = { code ->
                scope.launch {
                    isLoading = true
                    error = null
                    runCatching {
                        api.phoneAuth(current.id, code)
                        items = api.listApprovals()
                        selected = items.find { it.id == current.id } ?: selected
                    }.onFailure { error = it.message }
                    isLoading = false
                }
            },
            onItemUpdated = { fresh -> if (selected?.id == fresh.id) selected = fresh },
            onDecided = {
                selected = null
                error = null
                scope.launch { runCatching { items = api.listApprovals() } }
            },
        )
        return
    }

    // Main Approvals Dashboard Screen
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = {
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(
                            text = "ACCESOPRO",
                            style = MaterialTheme.typography.labelSmall.copy(
                                fontWeight = FontWeight.Black,
                                letterSpacing = 2.sp,
                            ),
                            color = MaterialTheme.colorScheme.primary,
                        )
                        Text(
                            text = when (mainTab) {
                                "censo" -> "Censo"
                                "historial" -> "Quienes están adentro"
                                else -> if (items.isEmpty()) "Cola de visitas" else "${items.size} pendiente${if (items.size == 1) "" else "s"}"
                            },
                            style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold),
                        )
                    }
                },
                actions = {
                    FilledTonalIconButton(
                        onClick = { manualOpen = true },
                        modifier = Modifier.padding(end = 4.dp),
                    ) {
                        Icon(Icons.Default.Add, contentDescription = "Carga manual")
                    }
                    IconButton(
                        onClick = {
                            prefs.edit().remove("token").remove("role").apply()
                            token = ""
                        },
                    ) {
                        Icon(Icons.Default.ExitToApp, contentDescription = "Cerrar sesión")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface),
            )
        },
        floatingActionButton = {
            LargeFloatingActionButton(
                onClick = { scanOpen = true },
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
            ) {
                Icon(ScanIcon, contentDescription = "Escanear QR o DNI", modifier = Modifier.size(40.dp))
            }
        },
        bottomBar = {
            GuardNavBar(
                tab = mainTab,
                canCensus = canCensus,
                canSos = canSos,
                onCola = { mainTab = "cola" },
                onCenso = {
                    if (!canCensus) {
                        error = "Sin permiso de censo (ops.census). Pedile al admin que lo habilite."
                    } else {
                        mainTab = "censo"
                        scope.launch {
                            runCatching { census = api.census() }.onFailure { error = it.message }
                        }
                    }
                },
                onHistorial = {
                    mainTab = "historial"
                    scope.launch {
                        runCatching { census = api.census() }.onFailure { error = it.message }
                    }
                },
                onSos = {
                    if (!canSos) {
                        error = "Sin permiso SOS (ops.alarms) o módulo pánico. Revisá grants del admin."
                    } else {
                        scope.launch {
                            runCatching {
                                api.panicSos()
                                error = "SOS enviado a portería"
                            }.onFailure { error = it.message }
                        }
                    }
                },
            )
        },
    ) { paddingValues ->
        when (mainTab) {
            "censo" -> CensusBody(
                snapshot = census,
                error = error,
                onRefresh = {
                    scope.launch {
                        runCatching { census = api.census() }.onFailure { error = it.message }
                    }
                },
                modifier = Modifier.padding(paddingValues),
            )
            "historial" -> OnsiteHistoryBody(
                snapshot = census,
                error = error,
                busy = isLoading,
                onRefresh = {
                    scope.launch {
                        runCatching { census = api.census() }.onFailure { error = it.message }
                    }
                },
                onRequestExit = { passId ->
                    scope.launch {
                        isLoading = true
                        error = null
                        runCatching {
                            val item = api.requestExit(passId)
                            items = api.listApprovals()
                            selected = item ?: items.find { it.passId == passId }
                            mainTab = "cola"
                        }.onFailure { error = it.message }
                        isLoading = false
                    }
                },
                modifier = Modifier.padding(paddingValues),
            )
            else -> Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            notice?.let { msg ->
                Surface(
                    color = MaterialTheme.colorScheme.primaryContainer,
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Row(
                        modifier = Modifier.padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Icon(Icons.Default.CheckCircle, contentDescription = null, tint = MaterialTheme.colorScheme.onPrimaryContainer)
                        Text(msg, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onPrimaryContainer)
                    }
                }
            }
            if (error != null) {
                Surface(
                    color = MaterialTheme.colorScheme.errorContainer,
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier.padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Icon(Icons.Default.Warning, contentDescription = null, tint = MaterialTheme.colorScheme.onErrorContainer)
                        Text(error!!, style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium), color = MaterialTheme.colorScheme.onErrorContainer)
                    }
                }
            }

            if (items.isEmpty()) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f),
                    contentAlignment = Alignment.Center
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(14.dp)
                    ) {
                        Surface(
                            shape = RoundedCornerShape(16.dp),
                            color = MaterialTheme.colorScheme.surfaceVariant,
                            modifier = Modifier.size(72.dp)
                        ) {
                            Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxSize()) {
                                Icon(
                                    imageVector = Icons.Default.CheckCircle,
                                    contentDescription = null,
                                    modifier = Modifier.size(36.dp),
                                    tint = MaterialTheme.colorScheme.primary
                                )
                            }
                        }
                        Text(
                            text = "Sin visitas pendientes",
                            style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold)
                        )
                        Text(
                            text = "Escaneá el QR de la visita, o el DNI del PDF417. Si no hay pase, podés anunciar al lote o registrar la visita.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(horizontal = 24.dp),
                            textAlign = TextAlign.Center
                        )
                        Button(
                            onClick = { scanOpen = true },
                            shape = RoundedCornerShape(12.dp),
                            modifier = Modifier.height(48.dp)
                        ) {
                            Icon(ScanIcon, contentDescription = null)
                            Spacer(Modifier.width(8.dp))
                            Text("Escanear QR o DNI", style = MaterialTheme.typography.labelLarge)
                        }
                    }
                }
            } else {
                LazyColumn(
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    contentPadding = PaddingValues(bottom = 112.dp),
                    modifier = Modifier.weight(1f)
                ) {
                    items(items, key = { it.id }) { row ->
                        val out = row.sentido == "out"
                        Card(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(12.dp))
                                .clickable { selected = row },
                            shape = RoundedCornerShape(12.dp),
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                            elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
                            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.6f)),
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(IntrinsicSize.Min),
                            ) {
                                Box(
                                    modifier = Modifier
                                        .width(4.dp)
                                        .fillMaxHeight()
                                        .background(laneBar(out)),
                                )
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(horizontal = 16.dp, vertical = 14.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                                ) {
                                    Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                        Text(
                                            text = row.guestName,
                                            style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                                        )
                                        Row(
                                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                                            verticalAlignment = Alignment.CenterVertically,
                                        ) {
                                            LaneChip(out = out, compact = true)
                                            Text(
                                                text = "Lote ${row.lotNumber ?: "—"}",
                                                style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium),
                                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            )
                                        }
                                        Text(
                                            text = buildString {
                                                append(if (row.guestDni.isNullOrBlank()) "DNI pendiente" else "DNI ${row.guestDni}")
                                                if (!row.qrHint.isNullOrBlank()) append(" · QR ${row.qrHint}")
                                            },
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                        if (!row.scanChannelLabel.isNullOrBlank()) {
                                            Text(
                                                text = listOfNotNull(row.scanChannelLabel, row.scannedByName).joinToString(" · "),
                                                style = MaterialTheme.typography.bodySmall,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            )
                                        }
                                        if (!row.dwellLabel.isNullOrBlank()) {
                                            Text(
                                                text = row.dwellLabel,
                                                style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold),
                                            )
                                        }
                                        if (row.minorsInCount > 0 || row.minorsCount > 0) {
                                            Text(
                                                text = if (out)
                                                    "Menores: salen ${row.minorsCount} / entraron ${row.minorsInCount}"
                                                else
                                                    "Menores: ${row.minorsCount}",
                                                style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Medium),
                                            )
                                        }
                                            Text(
                                                text = when {
                                                    row.reason == "expired" -> "Pase vencido"
                                                    row.reason == "walk_in" -> "Walk-in · espera titular (2 min)"
                                                    !row.verbalAuthorizedBy.isNullOrBlank() ->
                                                        "Verbal: ${row.verbalAuthorizedBy} · completar y abrir"
                                                    row.reason == "incomplete" || row.missing.isNotEmpty() ->
                                                        "Ficha incompleta · completar y abrir"
                                                    else -> "Listo · completar si falta y abrir"
                                                },
                                                style = MaterialTheme.typography.bodySmall.copy(
                                                    fontWeight = if (row.reason == "expired" || row.reason == "walk_in") FontWeight.Bold else FontWeight.Normal,
                                                ),
                                                color = when {
                                                    row.reason == "expired" -> MaterialTheme.colorScheme.error
                                                    row.reason == "walk_in" -> MaterialTheme.colorScheme.tertiary
                                                    else -> MaterialTheme.colorScheme.onSurfaceVariant
                                                },
                                                modifier = Modifier.padding(top = 2.dp),
                                            )
                                    }
                                    Surface(
                                        shape = RoundedCornerShape(8.dp),
                                        color = MaterialTheme.colorScheme.surfaceVariant,
                                        modifier = Modifier.size(36.dp)
                                    ) {
                                        Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxSize()) {
                                            Icon(
                                                imageVector = Icons.Default.KeyboardArrowRight,
                                                contentDescription = null,
                                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
            }
    }
}

@Composable
fun LoginScreen(
    baseUrl: String,
    onBaseUrlChange: (String) -> Unit,
    cloudUrl: String,
    onCloudUrlChange: (String) -> Unit,
    email: String,
    onEmailChange: (String) -> Unit,
    password: String,
    onPasswordChange: (String) -> Unit,
    error: String?,
    isLoading: Boolean,
    onLogin: () -> Unit,
) {
    var passwordVisible by remember { mutableStateOf(false) }
    var showServerConfig by remember { mutableStateOf(false) }
    val keyboardController = LocalSoftwareKeyboardController.current

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .statusBarsPadding()
            .navigationBarsPadding()
            .padding(24.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(24.dp)
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = MaterialTheme.colorScheme.primaryContainer,
                    modifier = Modifier.size(56.dp),
                ) {
                    Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxSize()) {
                        Text(
                            text = "AP",
                            style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Black),
                            color = MaterialTheme.colorScheme.onPrimaryContainer,
                        )
                    }
                }
                Text(
                    text = "AccesoPro",
                    style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.Bold),
                    color = MaterialTheme.colorScheme.onBackground,
                )
                Text(
                    text = "Control de acceso e ingresos del barrio",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
            }

            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.6f)),
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(24.dp),
                    verticalArrangement = Arrangement.spacedBy(18.dp)
                ) {
                    OutlinedTextField(
                        value = email,
                        onValueChange = onEmailChange,
                        label = { Text("Correo electrónico") },
                        leadingIcon = {
                            Icon(
                                imageVector = Icons.Default.Email,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary
                            )
                        },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(
                            keyboardType = KeyboardType.Email,
                            imeAction = ImeAction.Next
                        ),
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp)
                    )

                    OutlinedTextField(
                        value = password,
                        onValueChange = onPasswordChange,
                        label = { Text("Contraseña") },
                        leadingIcon = {
                            Icon(
                                imageVector = Icons.Default.Lock,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary
                            )
                        },
                        trailingIcon = {
                            TextButton(onClick = { passwordVisible = !passwordVisible }) {
                                Text(
                                    text = if (passwordVisible) "Ocultar" else "Ver",
                                    style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold)
                                )
                            }
                        },
                        visualTransformation = if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(
                            keyboardType = KeyboardType.Password,
                            imeAction = ImeAction.Done
                        ),
                        keyboardActions = KeyboardActions(
                            onDone = {
                                keyboardController?.hide()
                                onLogin()
                            }
                        ),
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp)
                    )

                    // Expandable Server API Configuration
                    Surface(
                        shape = RoundedCornerShape(12.dp),
                        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .clickable { showServerConfig = !showServerConfig }
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 14.dp, vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Settings,
                                    contentDescription = null,
                                    modifier = Modifier.size(18.dp),
                                    tint = MaterialTheme.colorScheme.primary
                                )
                                Text(
                                    text = "Configuración del servidor",
                                    style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium),
                                    color = MaterialTheme.colorScheme.onSurface
                                )
                            }
                            Icon(
                                imageVector = Icons.Default.ArrowDropDown,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }

                    if (showServerConfig) {
                        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            OutlinedTextField(
                                value = baseUrl,
                                onValueChange = onBaseUrlChange,
                                label = { Text("URL LAN (garita)") },
                                leadingIcon = {
                                    Icon(Icons.Default.Info, contentDescription = null)
                                },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(12.dp)
                            )
                            OutlinedTextField(
                                value = cloudUrl,
                                onValueChange = onCloudUrlChange,
                                label = { Text("URL pública (alternativa)") },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(12.dp)
                            )
                        }
                    }

                    // Error Message Container
                    if (!error.isNullOrBlank()) {
                        Surface(
                            color = MaterialTheme.colorScheme.errorContainer,
                            shape = RoundedCornerShape(12.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Row(
                                modifier = Modifier.padding(14.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Warning,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.onErrorContainer
                                )
                                Text(
                                    text = error,
                                    style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium),
                                    color = MaterialTheme.colorScheme.onErrorContainer
                                )
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(2.dp))

                    Button(
                        onClick = {
                            keyboardController?.hide()
                            onLogin()
                        },
                        enabled = !isLoading && email.isNotBlank() && password.isNotBlank(),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(50.dp),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        if (isLoading) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(24.dp),
                                color = MaterialTheme.colorScheme.onPrimary,
                                strokeWidth = 2.5.dp
                            )
                        } else {
                            Text(
                                text = "Ingresar al sistema",
                                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold)
                            )
                        }
                    }
                }
            }

            Text(
                text = "AccesoPro • Versión 0.1.0",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ResidentHome(
    name: String,
    api: GuardApi,
    error: String?,
    onLogout: () -> Unit,
    onError: (String?) -> Unit,
) {
    var notices by remember { mutableStateOf(listOf<OwnerNotice>()) }
    var accessQr by remember { mutableStateOf<AccessQrInfo?>(null) }
    var residentTab by remember { mutableStateOf("avisos") }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) {
        runCatching { accessQr = api.getAccessQr() }
        while (true) {
            runCatching { notices = api.listNotices() }
            delay(2000)
        }
    }
    BackHandler(enabled = residentTab != "avisos") { residentTab = "avisos" }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = {
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(
                            "ACCESOPRO",
                            style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Black, letterSpacing = 2.sp),
                            color = MaterialTheme.colorScheme.primary
                        )
                        Text(
                            when (residentTab) {
                                "mi_qr" -> "Mi QR de acceso"
                                else -> if (name.isBlank()) "Portal del lote" else name
                            },
                            style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold)
                        )
                    }
                },
                navigationIcon = {
                    if (residentTab != "avisos") {
                        IconButton(onClick = { residentTab = "avisos" }) {
                            Icon(Icons.Default.ArrowBack, contentDescription = "Volver")
                        }
                    }
                },
                actions = {
                    IconButton(onClick = onLogout) {
                        Icon(Icons.Default.ExitToApp, contentDescription = "Cerrar sesión")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface),
            )
        },
        bottomBar = {
            NavigationBar(
                containerColor = MaterialTheme.colorScheme.surface,
                tonalElevation = 3.dp,
            ) {
                NavigationBarItem(
                    selected = residentTab == "avisos",
                    onClick = { residentTab = "avisos" },
                    icon = { Icon(Icons.Default.Notifications, contentDescription = null) },
                    label = { Text("Avisos") },
                )
                NavigationBarItem(
                    selected = residentTab == "mi_qr",
                    onClick = { residentTab = "mi_qr" },
                    icon = { Icon(Icons.Default.AccountBox, contentDescription = null) },
                    label = { Text("Mi QR") },
                )
                NavigationBarItem(
                    selected = false,
                    onClick = {
                        scope.launch {
                            runCatching {
                                api.panicSos()
                                onError("SOS enviado a portería")
                            }.onFailure { onError(it.message) }
                        }
                    },
                    icon = { Icon(Icons.Default.Warning, contentDescription = null, tint = MaterialTheme.colorScheme.error) },
                    label = { Text("SOS") },
                )
            }
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            if (error != null) {
                Surface(
                    color = MaterialTheme.colorScheme.errorContainer,
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier.padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Icon(Icons.Default.Warning, contentDescription = null, tint = MaterialTheme.colorScheme.onErrorContainer)
                        Text(error, color = MaterialTheme.colorScheme.onErrorContainer, style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium))
                    }
                }
            }

            when (residentTab) {
                "mi_qr" -> {
                    Column(
                        modifier = Modifier
                            .fillMaxSize()
                            .verticalScroll(rememberScrollState())
                            .padding(vertical = 8.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        Text(
                            "Si la cara falla, mostrá este QR en el lector o a portería. Abre solo; no es el de visitas.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            textAlign = TextAlign.Center,
                        )
                        val payload = accessQr?.payload
                        if (accessQr?.active == true && !payload.isNullOrBlank()) {
                            AccessQrImage(
                                payload = payload,
                                modifier = Modifier
                                    .size(260.dp)
                                    .clip(RoundedCornerShape(12.dp))
                                    .background(androidx.compose.ui.graphics.Color.White)
                                    .padding(12.dp),
                            )
                            Text(
                                accessQr?.validUntil?.let { "Vence ${fmtDateTime(it)}" } ?: "Sin vencimiento",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                OutlinedButton(
                                    enabled = !busy,
                                    onClick = {
                                        scope.launch {
                                            busy = true
                                            runCatching {
                                                accessQr = api.issueAccessQr()
                                                onError("QR renovado")
                                            }.onFailure { onError(it.message) }
                                            busy = false
                                        }
                                    },
                                    shape = RoundedCornerShape(10.dp),
                                ) { Text("Renovar") }
                                Button(
                                    enabled = !busy,
                                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                                    onClick = {
                                        scope.launch {
                                            busy = true
                                            runCatching {
                                                api.revokeAccessQr()
                                                accessQr = api.getAccessQr()
                                                onError("QR revocado")
                                            }.onFailure { onError(it.message) }
                                            busy = false
                                        }
                                    },
                                    shape = RoundedCornerShape(10.dp),
                                ) { Text("Revocar") }
                            }
                        } else {
                            Text("Todavía no tenés QR de acceso.", style = MaterialTheme.typography.titleMedium)
                            Button(
                                enabled = !busy,
                                onClick = {
                                    scope.launch {
                                        busy = true
                                        runCatching { accessQr = api.issueAccessQr() }
                                            .onFailure { onError(it.message) }
                                        busy = false
                                    }
                                },
                                shape = RoundedCornerShape(10.dp),
                            ) { Text("Generar QR permanente") }
                        }
                    }
                }
                else -> {
                    val pending = notices.filter { it.status == "pending" }
                    if (pending.isEmpty()) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .weight(1f),
                            contentAlignment = Alignment.Center
                        ) {
                            Column(
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.spacedBy(12.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Notifications,
                                    contentDescription = null,
                                    modifier = Modifier.size(48.dp),
                                    tint = MaterialTheme.colorScheme.outline
                                )
                                Text(
                                    "Sin avisos pendientes",
                                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold)
                                )
                                Text(
                                    "Cuando haya una visita en el lote, aparecerá aquí para autorizar o denegar.",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    textAlign = TextAlign.Center,
                                    modifier = Modifier.padding(horizontal = 24.dp)
                                )
                            }
                        }
                    } else {
                        LazyColumn(
                            verticalArrangement = Arrangement.spacedBy(12.dp),
                            modifier = Modifier.weight(1f)
                        ) {
                            items(pending, key = { it.id }) { n ->
                                Card(
                                    modifier = Modifier.fillMaxWidth(),
                                    shape = RoundedCornerShape(12.dp),
                                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.6f)),
                                ) {
                                    Column(
                                        modifier = Modifier.padding(16.dp),
                                        verticalArrangement = Arrangement.spacedBy(10.dp)
                                    ) {
                                        Text(
                                            n.title,
                                            style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold)
                                        )
                                        Text(
                                            n.message,
                                            style = MaterialTheme.typography.bodyMedium,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant
                                        )
                                        if (n.kind == "visit_qr" || n.kind == "visit_info") {
                                            Surface(
                                                shape = RoundedCornerShape(8.dp),
                                                color = MaterialTheme.colorScheme.surfaceVariant,
                                                modifier = Modifier.fillMaxWidth()
                                            ) {
                                                Text(
                                                    if (n.kind == "visit_info") "Aviso informativo. No hace falta hacer nada."
                                                    else "Aviso informativo. Portería abre; no hace falta autorizar.",
                                                    style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Medium),
                                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                                    modifier = Modifier.padding(10.dp)
                                                )
                                            }
                                        } else {
                                            if (n.kind == "minors_mismatch") {
                                                Text(
                                                    "Portería marcó una diferencia de menores al salir de tu lote. Autorizá si corresponde.",
                                                    style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold),
                                                    color = MaterialTheme.colorScheme.tertiary,
                                                )
                                            }
                                            Row(
                                                horizontalArrangement = Arrangement.spacedBy(10.dp),
                                                modifier = Modifier.padding(top = 4.dp)
                                            ) {
                                                Button(
                                                    enabled = !busy,
                                                    onClick = {
                                                        scope.launch {
                                                            busy = true
                                                            runCatching {
                                                                api.decideNotice(n.id, "approved")
                                                                notices = api.listNotices()
                                                            }.onFailure { onError(it.message) }
                                                            busy = false
                                                        }
                                                    },
                                                    shape = RoundedCornerShape(10.dp),
                                                    modifier = Modifier.weight(1f)
                                                ) {
                                                    Text("Autorizar", fontWeight = FontWeight.Bold)
                                                }
                                                OutlinedButton(
                                                    enabled = !busy,
                                                    onClick = {
                                                        scope.launch {
                                                            busy = true
                                                            runCatching {
                                                                api.decideNotice(n.id, "denied")
                                                                notices = api.listNotices()
                                                            }.onFailure { onError(it.message) }
                                                            busy = false
                                                        }
                                                    },
                                                    shape = RoundedCornerShape(10.dp),
                                                    modifier = Modifier.weight(1f)
                                                ) {
                                                    Text("Denegar", fontWeight = FontWeight.Bold)
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    notices.filter { it.status != "pending" && it.decidedByName != null }.take(4).forEach { n ->
                        Text(
                            "${if (n.status == "approved") "Autorizó" else "Denegó"} ${n.decidedByName}: ${n.title}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CensusScreen(
    snapshot: CensusSnapshot?,
    error: String?,
    onBack: () -> Unit,
    onRefresh: () -> Unit,
) {
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = {
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(
                            text = "Censo de evacuación",
                            style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold)
                        )
                        Text(
                            text = "Personas y visitas en el predio",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Volver")
                    }
                },
                actions = {
                    IconButton(onClick = onRefresh) {
                        Icon(Icons.Default.Refresh, contentDescription = "Actualizar")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface)
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            if (!error.isNullOrBlank()) {
                Surface(
                    color = MaterialTheme.colorScheme.errorContainer,
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier.padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Icon(Icons.Default.Warning, contentDescription = null, tint = MaterialTheme.colorScheme.onErrorContainer)
                        Text(error, style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium), color = MaterialTheme.colorScheme.onErrorContainer)
                    }
                }
            }

            if (snapshot == null) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f),
                    contentAlignment = Alignment.Center
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(14.dp)
                    ) {
                        CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
                        Text("Cargando censo actualizado…", style = MaterialTheme.typography.bodyMedium)
                    }
                }
            } else {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    MetricCard("En predio", "${snapshot.total}", Modifier.weight(1f))
                    MetricCard("Lotes", "${snapshot.lotsWithPeople}", Modifier.weight(1f))
                    MetricCard("Adultos", "${snapshot.adults}", Modifier.weight(1f))
                    MetricCard("Menores", "${snapshot.minors}", Modifier.weight(1f), alert = snapshot.minors > 0)
                }

                Text(
                    text = "DETALLE POR LOTE",
                    style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold, letterSpacing = 1.2.sp),
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(top = 4.dp)
                )

                LazyColumn(
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.weight(1f)
                ) {
                    items(snapshot.lots, key = { it.lotNumber }) { lot ->
                        Card(
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(12.dp),
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.6f)),
                        ) {
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(16.dp),
                                verticalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text(
                                        text = "Lote ${lot.lotNumber} · ${lot.label}",
                                        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold)
                                    )
                                    Surface(
                                        shape = RoundedCornerShape(8.dp),
                                        color = MaterialTheme.colorScheme.primaryContainer
                                    ) {
                                        Text(
                                            text = "${lot.adults} ad. / ${lot.minors} men.",
                                            style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold),
                                            color = MaterialTheme.colorScheme.onPrimaryContainer,
                                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                                        )
                                    }
                                }

                                Text(
                                    text = "Titular: ${lot.ownerName ?: "Sin registrar"}",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )

                                if (!lot.phone.isNullOrBlank() || !lot.emergencyPhone.isNullOrBlank()) {
                                    Row(
                                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                                        modifier = Modifier.padding(top = 4.dp)
                                    ) {
                                        val ctx = LocalContext.current
                                        lot.phone?.let { p ->
                                            OutlinedButton(
                                                onClick = { ctx.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$p"))) },
                                                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                                                shape = RoundedCornerShape(10.dp),
                                                modifier = Modifier.height(36.dp)
                                            ) {
                                                Icon(Icons.Default.Call, contentDescription = null, modifier = Modifier.size(16.dp))
                                                Spacer(Modifier.width(6.dp))
                                                Text("Tel: $p", style = MaterialTheme.typography.labelMedium)
                                            }
                                        }
                                        lot.emergencyPhone?.let { ep ->
                                            OutlinedButton(
                                                onClick = { ctx.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$ep"))) },
                                                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                                                shape = RoundedCornerShape(10.dp),
                                                modifier = Modifier.height(36.dp)
                                            ) {
                                                Icon(Icons.Default.Warning, contentDescription = null, modifier = Modifier.size(16.dp))
                                                Spacer(Modifier.width(6.dp))
                                                Text("Emerg: $ep", style = MaterialTheme.typography.labelMedium)
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}



@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun IdentifyingScanScreen(onCancel: () -> Unit) {
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = { Text("Identificando") },
                navigationIcon = {
                    IconButton(onClick = onCancel) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Volver")
                    }
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            CircularProgressIndicator()
            Text(
                "El carril sale del pase: ingreso si es el primer acceso, salida si ya estaba adentro.",
                style = MaterialTheme.typography.bodyLarge,
                textAlign = TextAlign.Center,
            )
        }
    }
}

@Preview(showBackground = true)
@Composable
fun GuardAppPreview() {
    val mockPrefs = remember {
        object : android.content.SharedPreferences {
            override fun getAll(): Map<String, *> = emptyMap<String, Any>()
            override fun getString(key: String?, defValue: String?): String? = defValue
            override fun getStringSet(key: String?, defValues: Set<String>?): Set<String>? = defValues
            override fun getInt(key: String?, defValue: Int): Int = defValue
            override fun getLong(key: String?, defValue: Long): Long = defValue
            override fun getFloat(key: String?, defValue: Float): Float = defValue
            override fun getBoolean(key: String?, defValue: Boolean): Boolean = defValue
            override fun contains(key: String?): Boolean = false
            override fun edit(): android.content.SharedPreferences.Editor = object : android.content.SharedPreferences.Editor {
                override fun putString(key: String?, value: String?) = this
                override fun putStringSet(key: String?, values: Set<String>?) = this
                override fun putInt(key: String?, value: Int) = this
                override fun putLong(key: String?, value: Long) = this
                override fun putFloat(key: String?, value: Float) = this
                override fun putBoolean(key: String?, value: Boolean) = this
                override fun remove(key: String?) = this
                override fun clear() = this
                override fun commit(): Boolean = true
                override fun apply() {}
            }
            override fun registerOnSharedPreferenceChangeListener(listener: android.content.SharedPreferences.OnSharedPreferenceChangeListener?) {}
            override fun unregisterOnSharedPreferenceChangeListener(listener: android.content.SharedPreferences.OnSharedPreferenceChangeListener?) {}
        }
    }
    GuardTheme {
        Surface(modifier = Modifier.fillMaxSize()) {
            GuardApp(prefs = mockPrefs)
        }
    }
}

@Preview(showBackground = true)
@Composable
fun LoginScreenPreview() {
    GuardTheme {
        LoginScreen(
            baseUrl = "http://192.168.190.114:8787",
            onBaseUrlChange = {},
            cloudUrl = "",
            onCloudUrlChange = {},
            email = "guardia@lasacacias.local",
            onEmailChange = {},
            password = "password123",
            onPasswordChange = {},
            error = null,
            isLoading = false,
            onLogin = {}
        )
    }
}

@Preview(showBackground = true)
@Composable
fun ApprovalDetailPreview() {
    val sampleItem = ApprovalItem(
        id = "1",
        passId = "p123",
        sentido = "in",
        reason = "",
        guestName = "Carlos Gómez",
        guestDni = "32984102",
        patente = "AA 123 BB",
        needsTrunk = true,
        needsArt = false,
        visitKind = "social",
        missing = listOf("Seguro al día"),
        expiredDocs = emptyList(),
        lotNumber = "42",
        ownerName = "Juan Pérez",
        ownerPhone = "+5491155551234",
        ownerAuthStatus = "authorized",
        goodsAlert = false,
        goodsAuthorized = true,
        goodsCallReady = false,
        needsPhoneAuth = true,
        ownerAuthorizedByName = "María Pérez",
        emergencies = listOf(Emergency("Bomberos", "100"))
    )

    GuardTheme {
        ApprovalDetail(
            item = sampleItem,
            error = null,
            busy = false,
            onBack = {}
        )
    }
}

@Preview(showBackground = true)
@Composable
fun CensusScreenPreview() {
    val sampleCensus = CensusSnapshot(
        total = 28,
        adults = 20,
        minors = 8,
        lotsWithPeople = 12,
        lots = listOf(
            CensusLot("42", "Lote 42", 2, 2, "Juan Pérez", "1155551234", "100"),
            CensusLot("105", "Lote 105", 3, 0, "María López", "1144449876", "107")
        )
    )

    GuardTheme {
        CensusScreen(
            snapshot = sampleCensus,
            error = null,
            onBack = {},
            onRefresh = {}
        )
    }
}
