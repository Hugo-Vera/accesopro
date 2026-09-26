package ar.accesopro.guard

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountBox
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

@Composable
internal fun FichaCard(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.6f)),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            content = content,
        )
    }
}

@Composable
internal fun Banner(
    title: String?,
    text: String,
    container: androidx.compose.ui.graphics.Color,
    onContainer: androidx.compose.ui.graphics.Color,
    icon: androidx.compose.ui.graphics.vector.ImageVector? = null,
    extra: @Composable ColumnScope.() -> Unit = {},
) {
    Surface(color = container, shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (icon != null) Icon(icon, contentDescription = null, tint = onContainer, modifier = Modifier.size(20.dp))
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (title != null) {
                    Text(title, style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold), color = onContainer)
                }
                Text(text, style = MaterialTheme.typography.bodyMedium, color = onContainer)
                extra()
            }
        }
    }
}

@Composable
fun ApprovalDetail(
    item: ApprovalItem,
    api: GuardApi? = null,
    error: String? = null,
    busy: Boolean = false,
    onBack: () -> Unit,
    onPhoneAuth: (String) -> Unit = {},
    onItemUpdated: (ApprovalItem) -> Unit = {},
    onDecided: () -> Unit = {},
) {
    if (item.sentido == "out" || item.reentry) {
        ExitFicha(item, api, error, busy, onBack, onPhoneAuth, onItemUpdated, onDecided)
    } else {
        EntryFicha(item, api, error, busy, onBack, onPhoneAuth, onItemUpdated, onDecided)
    }
}

private fun entryStatusLine(item: ApprovalItem): Pair<String, String>? {
    val expired = item.reason == "expired" || item.reason == "too_early" ||
        item.windowState == "expired" || item.windowState == "too_early"
    if (expired) {
        return if (item.windowState == "too_early" || item.reason == "too_early")
            "red" to "Todavía no vale: habilitado desde ${fmtDateTime(item.validFrom)}"
        else "red" to "Pase vencido: valía hasta ${fmtDateTime(item.validUntil)}"
    }
    if (item.reason == "walk_in") {
        return when (item.ownerAuthStatus) {
            "owner_approved" -> "slate" to "Autorizó: ${item.ownerAuthorizedByName ?: "el lote"}"
            "owner_denied" -> "red" to "${item.ownerAuthorizedByName ?: "El lote"} rechazó. Denegá o llamá al lote."
            "owner_expired" -> "amber" to "El lote no contestó. Llamá y confirmá con tu código de guardia."
            else -> "amber" to "Avisamos al lote (2 min). La barrera la abrís vos."
        }
    }
    if (item.laneMismatch) {
        return "amber" to "Presentó el QR en el tótem de ${if (item.readerSentido == "out") "salida" else "ingreso"}: se trata como ingreso."
    }
    val who = item.ownerAuthorizedByName?.ifBlank { null }
        ?: item.verbalAuthorizedBy?.ifBlank { null }
        ?: item.ownerName.ifBlank { null }
    return who?.let { "slate" to "Autorizó: $it" }
}

/** Sección de la ficha a la que lleva cada faltante (la ficha es un solo scroll). */
private fun sectionOf(target: String) = when (target) {
    "identity" -> "identity"
    "vehicle" -> "vehicle"
    "art" -> "art"
    else -> "summary"
}

/** Ficha de ingreso en un solo scroll: solo las secciones que pide el tipo de ingreso y una barra fija para aprobar. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun EntryFicha(
    item: ApprovalItem,
    api: GuardApi?,
    error: String?,
    busy: Boolean,
    onBack: () -> Unit,
    onPhoneAuth: (String) -> Unit,
    onItemUpdated: (ApprovalItem) -> Unit,
    onDecided: () -> Unit,
) {
    val ctx = LocalContext.current
    var comment by remember { mutableStateOf("") }
    val trunk = item.trunkChecked
    var dni by remember(item.id) { mutableStateOf(item.guestDni ?: "") }
    var guestName by remember(item.id) { mutableStateOf(item.guestName) }
    var dniMatch by remember { mutableStateOf("") }
    var editIdentity by remember(item.id) { mutableStateOf(false) }
    var visitKind by remember(item.id) { mutableStateOf(item.visitKind.ifBlank { "social" }) }
    var arrivalMode by remember(item.id) { mutableStateOf(if (item.arrivalMode == "vehiculo") "vehiculo" else "peatonal") }
    var typeSheet by remember { mutableStateOf(false) }
    val req = docRequirements(visitKind, arrivalMode)

    var plate by remember(item.id) { mutableStateOf(item.patente ?: "") }
    var company by remember(item.id) { mutableStateOf("") }
    var policy by remember(item.id) { mutableStateOf("") }
    var until by remember(item.id) { mutableStateOf("") }
    var insReuse by remember(item.id) { mutableStateOf<String?>(null) }
    var insForm by remember(item.id) { mutableStateOf(false) }
    var vehPhoto by remember(item.id) { mutableStateOf<String?>(null) }
    var licUntil by remember(item.id) { mutableStateOf("") }
    var licNumber by remember(item.id) { mutableStateOf(item.guestDni?.filter { it.isDigit() } ?: "") }
    var licTouched by remember(item.id) { mutableStateOf(false) }
    var licReuse by remember(item.id) { mutableStateOf<String?>(null) }
    var licForm by remember(item.id) { mutableStateOf(false) }
    var licPhoto by remember(item.id) { mutableStateOf<String?>(null) }
    var artUntil by remember(item.id) { mutableStateOf("") }
    var artCompany by remember(item.id) { mutableStateOf("") }
    var artReuse by remember(item.id) { mutableStateOf<String?>(null) }
    var artForm by remember(item.id) { mutableStateOf(false) }
    var artPhoto by remember(item.id) { mutableStateOf<String?>(null) }
    val trunkInDraft = remember(item.id, item.trunkIn?.id, item.trunkIn?.photoIds, item.trunkIn?.description) {
        TrunkDraft(item.trunkIn)
    }

    var guardCode by remember { mutableStateOf("") }
    var scanDni by remember { mutableStateOf(false) }
    var scanCompanion by remember { mutableStateOf(false) }
    var minorsCount by remember(item.id) { mutableStateOf(item.minorsCount) }
    var companions by remember(item.id) { mutableStateOf(item.companions.map { CompanionItem(it.name, it.dni) }) }
    var localError by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    var history by remember(item.id) { mutableStateOf<IdentityHistory?>(null) }
    val scope = rememberCoroutineScope()
    val scroll = rememberScrollState()
    val sectionY = remember(item.id) { mutableStateMapOf<String, Int>() }
    var docScan by remember { mutableStateOf<String?>(null) }
    var docKind by remember { mutableStateOf("veh") }
    val enabled = !busy && !saving
    val artLabel = artLabelFor(visitKind)

    LaunchedEffect(dni) {
        val clean = dni.filter { it.isDigit() }
        if (!licTouched) licNumber = clean
        if (clean.length < 7 || api == null) return@LaunchedEffect
        history = runCatching { api.searchIdentity(clean, item.passId) }.getOrNull()
    }

    fun goTo(section: String) {
        val y = sectionY[section] ?: return
        scope.launch { scroll.animateScrollTo((y - 24).coerceAtLeast(0)) }
    }

    suspend fun persist(): ApprovalItem? {
        val a = api ?: return null
        val input = FichaInput(
            guestDni = dni,
            guestName = guestName,
            visitKind = visitKind,
            arrivalMode = arrivalMode,
            plate = if (req.vehicle) plate else "",
            insuranceReuseId = if (req.vehicle) insReuse else null,
            company = if (req.vehicle) company else "",
            policy = if (req.vehicle) policy else "",
            until = if (req.vehicle) until else "",
            cardPhoto = if (req.vehicle) vehPhoto else null,
            artReuseId = if (req.art) artReuse else null,
            artKind = if (visitKind == "service") "life" else "art",
            artUntil = if (req.art) artUntil else "",
            artCompany = if (req.art) artCompany else "",
            artPhoto = if (req.art) artPhoto else null,
            licReuseId = if (req.license) licReuse else null,
            licUntil = if (req.license) licUntil else "",
            licNumber = if (req.license) licNumber else "",
            licPhoto = if (req.license) licPhoto else null,
            minorsCount = minorsCount,
            companions = companions,
        )
        var fresh = a.saveFicha(item.id, input)
        if (req.trunk && trunkInDraft.dirty()) {
            fresh = a.uploadTrunk(item.id, trunkInDraft.description, trunkInDraft.newPhotos.toList(), trunkInDraft.removed.toList()) ?: fresh
        }
        vehPhoto = null
        licPhoto = null
        artPhoto = null
        insReuse = null
        licReuse = null
        artReuse = null
        insForm = false
        licForm = false
        artForm = false
        fresh?.let(onItemUpdated)
        return fresh
    }

    fun showApiError(e: Throwable) {
        if (e is ApiException) {
            e.item?.let { api?.parseApprovalJson(it) }?.let(onItemUpdated)
            if (e.missing.isNotEmpty()) {
                val infos = e.missing.map { missingInfo(it, "in") }
                localError = "${e.message}: ${infos.joinToString(", ") { it.first }}"
                infos.firstOrNull()?.let { goTo(sectionOf(it.second)) }
                return
            }
        }
        localError = e.message ?: "No se pudo guardar"
    }

    /** Guarda en segundo plano (foto nueva, cambio de tipo). Si falla, los datos quedan y viajan al aprobar. */
    fun autosave() {
        if (api == null) return
        scope.launch {
            saving = true
            runCatching { persist() }
            saving = false
        }
    }

    fun decide(decision: String) {
        val a = api ?: return
        scope.launch {
            saving = true
            localError = null
            runCatching {
                if (decision == "approved") persist()
                a.decide(item.id, decision, comment, trunk, if (decision == "approved") dni else "")
            }.onSuccess { onDecided() }
                .onFailure { showApiError(it) }
            saving = false
        }
    }

    fun toPedestrian() {
        val a = api ?: return
        scope.launch {
            saving = true
            localError = null
            runCatching { a.switchToPedestrian(item.id) }
                .onSuccess { fresh ->
                    arrivalMode = "peatonal"
                    plate = ""
                    fresh?.let(onItemUpdated)
                }
                .onFailure { showApiError(it) }
            saving = false
        }
    }

    val scanner = rememberDocumentScanner(
        onPhoto = { b64 ->
            when (docKind) {
                "veh" -> vehPhoto = b64
                "lic" -> licPhoto = b64
                else -> artPhoto = b64
            }
            autosave()
        },
        onUnavailable = { docScan = docKind },
        onError = { localError = it },
    )
    val shoot: (String) -> Unit = { kind ->
        docKind = kind
        scanner()
    }

    BackHandler {
        when {
            scanDni -> scanDni = false
            scanCompanion -> scanCompanion = false
            typeSheet -> typeSheet = false
            editIdentity -> editIdentity = false
            else -> onBack()
        }
    }

    docScan?.let { kind ->
        DocScanScreen(
            title = when (kind) {
                "veh" -> "Tarjeta del seguro"
                "lic" -> "Licencia de conducir"
                else -> artLabel
            },
            onPhoto = { b64 ->
                when (kind) {
                    "veh" -> vehPhoto = b64
                    "lic" -> licPhoto = b64
                    else -> artPhoto = b64
                }
                docScan = null
                autosave()
            },
            onClose = { docScan = null },
            onError = { localError = it },
        )
        return
    }

    if (scanDni) {
        BarcodeScanScreen(
            title = "DNI (PDF417 o QR)",
            onClose = { scanDni = false },
            onResult = { raw ->
                scanDni = false
                scope.launch {
                    val n = runCatching { api?.parseDni(raw) }.getOrNull()
                    if (n != null) {
                        val match = dniIdentityMatches(n, dni, guestName)
                        dni = n.dni
                        if (match) {
                            dniMatch = "ok"
                        } else {
                            val name = n.fullName()
                            if (name.isNotBlank()) guestName = name
                            dniMatch = "filled"
                        }
                        editIdentity = false
                    }
                }
            },
        )
        return
    }

    if (scanCompanion) {
        BarcodeScanScreen(
            title = "DNI de acompañante (PDF417 o QR)",
            onClose = { scanCompanion = false },
            onResult = { raw ->
                scanCompanion = false
                scope.launch {
                    val n = runCatching { api?.parseDni(raw) }.getOrNull()
                    if (n != null) {
                        val name = n.fullName().ifBlank { "Acompañante" }
                        companions = companions + CompanionItem(name, n.dni)
                    }
                }
            },
        )
        return
    }

    if (typeSheet) {
        ModalBottomSheet(onDismissRequest = { typeSheet = false; autosave() }) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 8.dp)
                    .navigationBarsPadding(),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                SectionTitle("QUIÉN ES")
                ChoiceGrid(VISIT_KINDS, visitKind, enabled = enabled) { visitKind = it }
                SectionTitle("CÓMO LLEGA")
                ChoiceGrid(ARRIVAL_MODES, arrivalMode, enabled = enabled) { arrivalMode = it }
                RequiredDocsList(visitKind, arrivalMode, dniRead = dni.isNotBlank())
                Button(
                    onClick = { typeSheet = false; autosave() },
                    modifier = Modifier.fillMaxWidth().height(48.dp),
                    shape = RoundedCornerShape(12.dp),
                ) { Text("Listo") }
            }
        }
    }

    val status = entryStatusLine(item)
    val shown = error ?: localError
    val blockReason = when {
        item.expiredDocs.isNotEmpty() -> item.expiredDocs.joinToString(" · ") { expiredLabel(it) }
        item.missing.isNotEmpty() -> item.missing.joinToString(" · ") { missingInfo(it, "in").first }
        else -> null
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        "Ingreso · Lote ${item.lotNumber ?: "—"}",
                        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                        maxLines = 1,
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, contentDescription = "Volver") }
                },
                actions = { Box(Modifier.padding(end = 8.dp)) { LaneChip(out = false) } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface),
            )
        },
        bottomBar = {
            Surface(color = MaterialTheme.colorScheme.surface, tonalElevation = 6.dp) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .navigationBarsPadding()
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    if (shown != null) {
                        Banner(
                            title = null,
                            text = shown,
                            container = MaterialTheme.colorScheme.errorContainer,
                            onContainer = MaterialTheme.colorScheme.onErrorContainer,
                            icon = Icons.Default.Warning,
                        )
                    } else if (blockReason != null) {
                        Text(
                            "Falta: $blockReason",
                            style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.SemiBold),
                            color = MaterialTheme.colorScheme.error,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.clickable {
                                item.missing.firstOrNull()?.let { goTo(sectionOf(missingInfo(it, "in").second)) }
                            },
                        )
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
                        OutlinedButton(
                            onClick = { decide("denied") },
                            enabled = enabled,
                            modifier = Modifier.weight(1f).height(52.dp),
                            shape = RoundedCornerShape(12.dp),
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                        ) {
                            Icon(Icons.Default.Close, contentDescription = null)
                            Spacer(Modifier.width(6.dp))
                            Text("Denegar", style = MaterialTheme.typography.labelLarge)
                        }
                        Button(
                            onClick = { decide("approved") },
                            enabled = enabled && item.expiredDocs.isEmpty(),
                            modifier = Modifier.weight(1.5f).height(52.dp),
                            shape = RoundedCornerShape(12.dp),
                        ) {
                            if (busy || saving) {
                                CircularProgressIndicator(Modifier.size(20.dp), color = MaterialTheme.colorScheme.onPrimary, strokeWidth = 2.dp)
                            } else {
                                Icon(Icons.Default.CheckCircle, contentDescription = null)
                                Spacer(Modifier.width(6.dp))
                                Text("Aprobar y abrir", style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Bold))
                            }
                        }
                    }
                }
            }
        },
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .verticalScroll(scroll)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            // Cabecera: nombre bien visible, DNI y tipo de ingreso (tocando el chip se cambia).
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .onGloballyPositioned { sectionY["identity"] = it.positionInParent().y.toInt() },
                shape = RoundedCornerShape(14.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
            ) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            guestName.ifBlank { "Sin nombre" },
                            style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.Bold),
                            color = MaterialTheme.colorScheme.onPrimaryContainer,
                            modifier = Modifier.weight(1f),
                        )
                        IconButton(onClick = { editIdentity = !editIdentity }, enabled = enabled) {
                            Icon(Icons.Default.Edit, contentDescription = "Editar identidad", tint = MaterialTheme.colorScheme.onPrimaryContainer)
                        }
                    }
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Icon(Icons.Default.AccountBox, contentDescription = null, tint = MaterialTheme.colorScheme.onPrimaryContainer, modifier = Modifier.size(18.dp))
                        Text(
                            when {
                                dni.isBlank() -> "DNI pendiente"
                                dniMatch == "ok" -> "DNI $dni · verificado"
                                else -> "DNI $dni"
                            },
                            style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.SemiBold),
                            color = if (dni.isBlank()) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onPrimaryContainer,
                            modifier = Modifier.weight(1f),
                        )
                        TextButton(onClick = { scanDni = true }, enabled = enabled) {
                            Text(if (dni.isBlank()) "Escanear DNI" else "Verificar")
                        }
                    }
                    Text(
                        "${item.ownerName.ifBlank { "Sin titular" }}${item.patente?.let { " · $it" } ?: ""}",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onPrimaryContainer,
                    )
                    AssistChip(
                        onClick = { typeSheet = true },
                        enabled = enabled,
                        label = { Text("${visitKindLabel(visitKind)} · ${arrivalModeLabel(arrivalMode)}", fontWeight = FontWeight.Bold) },
                        trailingIcon = { Icon(Icons.Default.Edit, contentDescription = "Cambiar tipo de ingreso", modifier = Modifier.size(16.dp)) },
                        colors = AssistChipDefaults.assistChipColors(containerColor = MaterialTheme.colorScheme.surface),
                    )
                    if (editIdentity || dni.isBlank()) {
                        OutlinedTextField(
                            value = guestName,
                            onValueChange = { guestName = it },
                            label = { Text("Nombre y apellido") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(12.dp),
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedContainerColor = MaterialTheme.colorScheme.surface,
                                unfocusedContainerColor = MaterialTheme.colorScheme.surface,
                            ),
                        )
                        OutlinedTextField(
                            value = dni,
                            onValueChange = { dni = it.filter { ch -> ch.isDigit() }.take(9) },
                            label = { Text("DNI") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(12.dp),
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedContainerColor = MaterialTheme.colorScheme.surface,
                                unfocusedContainerColor = MaterialTheme.colorScheme.surface,
                            ),
                        )
                        if (editIdentity) {
                            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                OutlinedButton(
                                    onClick = {
                                        guestName = item.guestName
                                        dni = item.guestDni ?: ""
                                        editIdentity = false
                                    },
                                    shape = RoundedCornerShape(10.dp),
                                ) { Text("Cancelar") }
                                Button(
                                    onClick = { editIdentity = false; autosave() },
                                    enabled = enabled && guestName.isNotBlank(),
                                    shape = RoundedCornerShape(10.dp),
                                ) { Text("Guardar") }
                            }
                        }
                    }
                }
            }

            HistoryCard(history, compact = true)

            status?.let { (tone, text) ->
                when (tone) {
                    "red" -> Banner(null, text, MaterialTheme.colorScheme.errorContainer, MaterialTheme.colorScheme.onErrorContainer, Icons.Default.Warning)
                    "amber" -> Banner(null, text, MaterialTheme.colorScheme.tertiaryContainer, MaterialTheme.colorScheme.onTertiaryContainer, Icons.Default.Info)
                    else -> Text(
                        text,
                        style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            if (item.expiredDocs.isNotEmpty()) {
                Banner(
                    title = "Documento vencido: no puede ingresar",
                    text = item.expiredDocs.joinToString(" · ") { expiredLabel(it) } +
                        if (item.canSwitchToPedestrian) ". Puede estacionar afuera y entrar a pie."
                        else ". Solo se puede denegar.",
                    container = MaterialTheme.colorScheme.errorContainer,
                    onContainer = MaterialTheme.colorScheme.onErrorContainer,
                    icon = Icons.Default.Warning,
                ) {
                    if (item.canSwitchToPedestrian) {
                        Button(onClick = { toPedestrian() }, enabled = enabled, shape = RoundedCornerShape(10.dp)) {
                            Text("Pasar a peatonal")
                        }
                    }
                }
            }
            if (item.needsPhoneAuth) {
                FichaCard {
                    SectionTitle("AUTORIZACIÓN POR TELÉFONO")
                    item.ownerPhone?.let { phone ->
                        OutlinedButton(
                            onClick = { ctx.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$phone"))) },
                            modifier = Modifier.fillMaxWidth().height(44.dp),
                            shape = RoundedCornerShape(12.dp),
                        ) {
                            Icon(Icons.Default.Call, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(8.dp))
                            Text("Llamar al lote (${item.ownerName})")
                        }
                    }
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        OutlinedTextField(
                            value = guardCode,
                            onValueChange = { guardCode = it.filter { ch -> ch.isDigit() }.take(8) },
                            label = { Text("Código de guardia") },
                            modifier = Modifier.weight(1f),
                            shape = RoundedCornerShape(12.dp),
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                            visualTransformation = PasswordVisualTransformation(),
                        )
                        Button(
                            onClick = { onPhoneAuth(guardCode) },
                            enabled = !busy && guardCode.length >= 4,
                            shape = RoundedCornerShape(12.dp),
                        ) { Text("Confirmar") }
                    }
                }
            }

            if (req.vehicle) {
                FichaCard(Modifier.onGloballyPositioned { sectionY["vehicle"] = it.positionInParent().y.toInt() }) {
                    SectionTitle("VEHÍCULO")
                    OutlinedTextField(
                        value = plate,
                        onValueChange = { plate = it.uppercase().filter { ch -> ch.isLetterOrDigit() }.take(10) },
                        label = { Text("Patente") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                    )
                    SectionTitle("SEGURO DEL AUTO")
                    val linkedIns = item.insurance
                    val fileIns = item.onFile.insurance
                    if (linkedIns != null && !insForm) {
                        DocLinkedRow("Seguro", linkedIns, onReplace = { insForm = true }, enabled = enabled)
                        if (!linkedIns.hasDocument) {
                            DocPhotoButton("tarjeta del seguro", vehPhoto, false, enabled, { shoot("veh") }) { vehPhoto = null }
                        }
                    } else if (fileIns != null && !insForm) {
                        DocOnFileCard(
                            "seguro${fileIns.plate?.let { " de $it" } ?: ""}",
                            fileIns,
                            using = insReuse == fileIns.id,
                            enabled = enabled,
                            onUse = { insReuse = fileIns.id },
                            onNew = { insForm = true; insReuse = null },
                        )
                    } else {
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                            OutlinedTextField(
                                value = company,
                                onValueChange = { company = it },
                                label = { Text("Aseguradora") },
                                singleLine = true,
                                modifier = Modifier.weight(1f),
                                shape = RoundedCornerShape(12.dp),
                            )
                            OutlinedTextField(
                                value = policy,
                                onValueChange = { policy = it },
                                label = { Text("N° de póliza") },
                                singleLine = true,
                                modifier = Modifier.weight(1f),
                                shape = RoundedCornerShape(12.dp),
                            )
                        }
                        DateField("Vence el seguro", until, { until = it }, enabled)
                        DocPhotoButton("tarjeta del seguro", vehPhoto, false, enabled, { shoot("veh") }) { vehPhoto = null }
                    }

                    SectionTitle("LICENCIA DE CONDUCIR")
                    val linkedLic = item.license
                    val fileLic = item.onFile.license
                    if (linkedLic != null && !licForm) {
                        DocLinkedRow("Licencia", linkedLic, onReplace = { licForm = true }, enabled = enabled)
                        if (!linkedLic.hasDocument) {
                            DocPhotoButton("licencia", licPhoto, false, enabled, { shoot("lic") }) { licPhoto = null }
                        }
                    } else if (fileLic != null && !licForm) {
                        DocOnFileCard(
                            "licencia",
                            fileLic,
                            using = licReuse == fileLic.id,
                            enabled = enabled,
                            onUse = { licReuse = fileLic.id },
                            onNew = { licForm = true; licReuse = null },
                        )
                    } else {
                        OutlinedTextField(
                            value = licNumber,
                            onValueChange = {
                                licNumber = it.filter { ch -> ch.isDigit() }.take(12)
                                licTouched = true
                            },
                            label = { Text("N° de licencia") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(12.dp),
                        )
                        DateField("Vence la licencia", licUntil, { licUntil = it }, enabled)
                        DocPhotoButton("licencia", licPhoto, false, enabled, { shoot("lic") }) { licPhoto = null }
                    }
                    HorizontalDivider()
                    SectionTitle("BAÚL")
                    TrunkEditor(api, item.trunkIn, trunkInDraft, "Qué lleva en el baúl", enabled) { localError = it }
                }
            }

            if (req.art) {
                FichaCard(Modifier.onGloballyPositioned { sectionY["art"] = it.positionInParent().y.toInt() }) {
                    SectionTitle(artLabel.uppercase())
                    val linkedArt = item.personInsurance
                    val fileArt = item.onFile.art
                    if (linkedArt != null && !artForm) {
                        DocLinkedRow(artLabel, linkedArt, onReplace = { artForm = true }, enabled = enabled)
                        if (!linkedArt.hasDocument) {
                            DocPhotoButton("constancia", artPhoto, false, enabled, { shoot("art") }) { artPhoto = null }
                        }
                    } else if (fileArt != null && !artForm) {
                        DocOnFileCard(
                            if (fileArt.kind == "life") "seguro de vida" else "ART",
                            fileArt,
                            using = artReuse == fileArt.id,
                            enabled = enabled,
                            onUse = { artReuse = fileArt.id },
                            onNew = { artForm = true; artReuse = null },
                        )
                    } else {
                        OutlinedTextField(
                            value = artCompany,
                            onValueChange = { artCompany = it },
                            label = { Text(if (visitKind == "service") "Compañía (ART o seguro)" else "Compañía ART") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(12.dp),
                        )
                        DateField("Vence", artUntil, { artUntil = it }, enabled)
                        DocPhotoButton("constancia", artPhoto, false, enabled, { shoot("art") }) { artPhoto = null }
                    }
                }
            }

            FichaCard(Modifier.onGloballyPositioned { sectionY["summary"] = it.positionInParent().y.toInt() }) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Column(Modifier.weight(1f)) {
                        Text("Menores", fontWeight = FontWeight.Bold)
                        Text(
                            "Solo la cantidad",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    OutlinedButton(onClick = { minorsCount = (minorsCount - 1).coerceAtLeast(0) }, enabled = enabled) { Text("−") }
                    Text("$minorsCount", style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold))
                    OutlinedButton(onClick = { minorsCount = (minorsCount + 1).coerceAtMost(20) }, enabled = enabled) { Text("+") }
                }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(
                        if (companions.isEmpty()) "Sin acompañantes"
                        else companions.joinToString { c -> listOfNotNull(c.name.ifBlank { null }, c.dni).joinToString(" · ") },
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.weight(1f),
                    )
                    FilledTonalButton(
                        onClick = { scanCompanion = true },
                        enabled = enabled,
                        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                        shape = RoundedCornerShape(10.dp),
                    ) {
                        Icon(Icons.Default.Person, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Acompañante")
                    }
                }
                OutlinedTextField(
                    value = comment,
                    onValueChange = { comment = it },
                    label = { Text("Notas de la guardia") },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                )
            }

            if (!item.needsPhoneAuth && (item.ownerPhone != null || item.emergencies.isNotEmpty())) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    item.ownerPhone?.let { phone ->
                        OutlinedButton(
                            onClick = { ctx.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$phone"))) },
                            shape = RoundedCornerShape(12.dp),
                        ) {
                            Icon(Icons.Default.Call, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Llamar al lote")
                        }
                    }
                    item.emergencies.take(2).forEach { e ->
                        TextButton(onClick = { ctx.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:${e.phone}"))) }) {
                            Text(e.label, maxLines = 1)
                        }
                    }
                }
            }
        }
    }
}
