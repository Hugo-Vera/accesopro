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
import androidx.compose.material.icons.filled.Add
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

@Composable
internal fun FichaCard(content: @Composable ColumnScope.() -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.6f)),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
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
    var visitKind by remember(item.id) { mutableStateOf(item.visitKind.ifBlank { "social" }) }
    var arrivalMode by remember(item.id) { mutableStateOf(if (item.arrivalMode == "vehiculo") "vehiculo" else "peatonal") }
    val req = docRequirements(visitKind, arrivalMode)
    val pages = remember(req) {
        buildList {
            add("identity")
            add("type")
            if (req.vehicle) add("vehicle")
            if (req.art) add("art")
            add("summary")
        }
    }
    var pageKey by remember(item.id) { mutableStateOf("identity") }
    val page = pages.indexOf(pageKey).let { if (it < 0) 0 else it }
    val curKey = pages[page]

    var plate by remember(item.id) { mutableStateOf(item.patente ?: "") }
    var company by remember(item.id) { mutableStateOf("") }
    var policy by remember(item.id) { mutableStateOf("") }
    var until by remember(item.id) { mutableStateOf("") }
    var insReuse by remember(item.id) { mutableStateOf<String?>(null) }
    var insForm by remember(item.id) { mutableStateOf(false) }
    var vehPhoto by remember(item.id) { mutableStateOf<String?>(null) }
    var licUntil by remember(item.id) { mutableStateOf("") }
    var licNumber by remember(item.id) { mutableStateOf("") }
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
    val scope = rememberCoroutineScope()
    var docScan by remember { mutableStateOf<String?>(null) }
    val shootVeh = { docScan = "veh" }
    val shootLic = { docScan = "lic" }
    val shootArt = { docScan = "art" }
    val enabled = !busy && !saving
    val artLabel = artLabelFor(visitKind)

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
                infos.map { it.second }.firstOrNull { it in pages }?.let { pageKey = it }
                return
            }
        }
        localError = e.message ?: "No se pudo guardar"
    }

    fun saveAndGo(target: String?) {
        scope.launch {
            saving = true
            localError = null
            runCatching { persist() }
                .onSuccess { if (target != null) pageKey = target }
                .onFailure { showApiError(it) }
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
                    pageKey = if (docRequirements(visitKind, "peatonal").art) "art" else "summary"
                }
                .onFailure { showApiError(it) }
            saving = false
        }
    }

    BackHandler {
        when {
            scanDni -> scanDni = false
            scanCompanion -> scanCompanion = false
            page > 0 -> pageKey = pages[page - 1]
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

    val status = entryStatusLine(item)

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = {
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(
                            text = item.guestName,
                            style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold),
                            maxLines = 1,
                        )
                        Text(
                            text = "ENTRADA · Lote ${item.lotNumber ?: "—"} · ${item.ownerName.ifBlank { "Sin titular" }}",
                            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                        )
                    }
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
                        .padding(horizontal = 16.dp, vertical = 14.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    val shown = error ?: localError
                    if (shown != null) {
                        Banner(
                            title = null,
                            text = shown,
                            container = MaterialTheme.colorScheme.errorContainer,
                            onContainer = MaterialTheme.colorScheme.onErrorContainer,
                            icon = Icons.Default.Warning,
                        )
                    }
                    Text(
                        "Paso ${page + 1} de ${pages.size}",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (curKey != "summary") {
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
                            if (page > 0) {
                                OutlinedButton(
                                    onClick = { pageKey = pages[page - 1] },
                                    enabled = enabled,
                                    modifier = Modifier.weight(1f).height(50.dp),
                                    shape = RoundedCornerShape(12.dp),
                                ) { Text("Anterior") }
                            }
                            Button(
                                onClick = { saveAndGo(pages[(page + 1).coerceAtMost(pages.lastIndex)]) },
                                enabled = enabled,
                                modifier = Modifier.weight(1f).height(50.dp),
                                shape = RoundedCornerShape(12.dp),
                            ) {
                                if (saving) {
                                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                                } else {
                                    Text("Guardar y siguiente")
                                }
                            }
                        }
                    } else {
                        OutlinedButton(
                            onClick = { pageKey = pages[(page - 1).coerceAtLeast(0)] },
                            enabled = enabled,
                            modifier = Modifier.fillMaxWidth().height(46.dp),
                            shape = RoundedCornerShape(12.dp),
                        ) { Text("Anterior", style = MaterialTheme.typography.labelLarge) }
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
                            OutlinedButton(
                                onClick = { decide("denied") },
                                enabled = enabled,
                                modifier = Modifier.weight(1f).height(50.dp),
                                shape = RoundedCornerShape(12.dp),
                                colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                            ) {
                                Icon(Icons.Default.Close, contentDescription = null)
                                Spacer(Modifier.width(6.dp))
                                Text("Denegar", style = MaterialTheme.typography.labelLarge)
                            }
                            val blocked = item.expiredDocs.isNotEmpty()
                            Button(
                                onClick = { decide("approved") },
                                enabled = enabled && !blocked,
                                modifier = Modifier.weight(1f).height(50.dp),
                                shape = RoundedCornerShape(12.dp),
                            ) {
                                if (busy || saving) {
                                    CircularProgressIndicator(Modifier.size(20.dp), color = MaterialTheme.colorScheme.onPrimary, strokeWidth = 2.dp)
                                    Spacer(Modifier.width(8.dp))
                                    Text("Abriendo…")
                                } else {
                                    Icon(Icons.Default.CheckCircle, contentDescription = null)
                                    Spacer(Modifier.width(6.dp))
                                    Text("Aprobar y abrir", style = MaterialTheme.typography.labelLarge)
                                }
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
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            status?.let { (tone, text) ->
                when (tone) {
                    "red" -> Banner(
                        title = null,
                        text = text,
                        container = MaterialTheme.colorScheme.errorContainer,
                        onContainer = MaterialTheme.colorScheme.onErrorContainer,
                        icon = Icons.Default.Warning,
                    )
                    "amber" -> Banner(
                        title = null,
                        text = text,
                        container = MaterialTheme.colorScheme.tertiaryContainer,
                        onContainer = MaterialTheme.colorScheme.onTertiaryContainer,
                        icon = Icons.Default.Info,
                    )
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
                        if (item.canSwitchToPedestrian) ". Puede estacionar afuera y entrar a pie: se le toman los datos como ingreso caminando."
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
            if (item.missing.isNotEmpty()) {
                Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Icon(Icons.Default.Info, contentDescription = null, modifier = Modifier.size(20.dp))
                            Text("Falta completar", fontWeight = FontWeight.Bold)
                        }
                        item.missing.forEach { key ->
                            val (label, target) = missingInfo(key, "in")
                            Text(
                                "· $label",
                                style = MaterialTheme.typography.bodyMedium,
                                color = if (target in pages) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                                modifier = Modifier.clickable(enabled = target in pages) { pageKey = target },
                            )
                        }
                    }
                }
            }
            when (curKey) {
                "identity" -> FichaCard {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        SectionTitle("IDENTIDAD")
                        FilledTonalButton(
                            onClick = { scanDni = true },
                            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                            shape = RoundedCornerShape(10.dp),
                        ) {
                            Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Escanear DNI", style = MaterialTheme.typography.labelLarge)
                        }
                    }
                    if (dniMatch.isEmpty()) {
                        Text(
                            "Escaneá el DNI para confirmar.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    OutlinedTextField(
                        value = guestName,
                        onValueChange = { guestName = it },
                        label = { Text("Nombre y apellido") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                    )
                    OutlinedTextField(
                        value = dni,
                        onValueChange = { dni = it },
                        label = { Text("DNI") },
                        leadingIcon = { Icon(Icons.Default.AccountBox, contentDescription = null, tint = MaterialTheme.colorScheme.primary) },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                    )
                    if (dniMatch == "ok") {
                        Text("El DNI coincide con el precargado.", color = MaterialTheme.colorScheme.primary)
                    } else if (dniMatch == "filled") {
                        Text("Se cargaron nombre y DNI desde el plástico.", color = MaterialTheme.colorScheme.tertiary)
                    }
                    HorizontalDivider(modifier = Modifier.padding(vertical = 4.dp))
                    SectionTitle("ACOMPAÑANTES Y MENORES")
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text("Menores", fontWeight = FontWeight.Bold)
                            Text(
                                "Solo la cantidad, sin nombre ni DNI.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            OutlinedButton(onClick = { minorsCount = (minorsCount - 1).coerceAtLeast(0) }, enabled = enabled) { Text("−") }
                            Text("$minorsCount", style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold))
                            OutlinedButton(onClick = { minorsCount = (minorsCount + 1).coerceAtMost(20) }, enabled = enabled) { Text("+") }
                        }
                    }
                    OutlinedButton(
                        onClick = { scanCompanion = true },
                        modifier = Modifier.fillMaxWidth().height(46.dp),
                        shape = RoundedCornerShape(12.dp),
                    ) {
                        Icon(Icons.Default.Person, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text("Acompañante (escanear DNI)")
                    }
                    if (companions.isNotEmpty()) {
                        Text(
                            companions.joinToString { c -> listOfNotNull(c.name.ifBlank { null }, c.dni).joinToString(" · ") },
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }

                "type" -> FichaCard {
                    SectionTitle("TIPO DE INGRESO")
                    ChoiceGrid(VISIT_KINDS, visitKind, enabled = enabled) { visitKind = it }
                    SectionTitle("CÓMO LLEGA")
                    ChoiceGrid(ARRIVAL_MODES, arrivalMode, enabled = enabled) { arrivalMode = it }
                    if (req.vehicle) {
                        OutlinedTextField(
                            value = plate,
                            onValueChange = { plate = it.uppercase().take(10) },
                            label = { Text("Patente") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(12.dp),
                        )
                    }
                    Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text("Se pide:", fontWeight = FontWeight.Bold)
                            Text("DNI")
                            if (req.vehicle) Text("Patente, seguro del auto con foto y licencia con vencimiento y foto")
                            if (req.art) Text("$artLabel con vencimiento y constancia")
                            if (req.trunk) Text("Revisión de baúl: descripción o fotos")
                        }
                    }
                }

                "vehicle" -> {
                    FichaCard {
                        SectionTitle("VEHÍCULO")
                        OutlinedTextField(
                            value = plate,
                            onValueChange = { plate = it.uppercase().take(10) },
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
                                DocPhotoButton("tarjeta del seguro", vehPhoto, false, enabled, shootVeh) { vehPhoto = null }
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
                            DocPhotoButton("tarjeta del seguro", vehPhoto, false, enabled, shootVeh) { vehPhoto = null }
                        }

                        SectionTitle("LICENCIA DE CONDUCIR")
                        val linkedLic = item.license
                        val fileLic = item.onFile.license
                        if (linkedLic != null && !licForm) {
                            DocLinkedRow("Licencia", linkedLic, onReplace = { licForm = true }, enabled = enabled)
                            if (!linkedLic.hasDocument) {
                                DocPhotoButton("licencia", licPhoto, false, enabled, shootLic) { licPhoto = null }
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
                                onValueChange = { licNumber = it },
                                label = { Text("N° de licencia") },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(12.dp),
                            )
                            DateField("Vence la licencia", licUntil, { licUntil = it }, enabled)
                            DocPhotoButton("licencia", licPhoto, false, enabled, shootLic) { licPhoto = null }
                        }
                    }
                    FichaCard {
                        SectionTitle("REVISIÓN DE BAÚL")
                        Text(
                            "Describí qué lleva y sacá una o varias fotos de respaldo. En la salida se comparan.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        TrunkEditor(api, item.trunkIn, trunkInDraft, "Contenido del baúl", enabled) { localError = it }
                    }
                }

                "art" -> FichaCard {
                    SectionTitle(artLabel.uppercase())
                    val linkedArt = item.personInsurance
                    val fileArt = item.onFile.art
                    if (linkedArt != null && !artForm) {
                        DocLinkedRow(artLabel, linkedArt, onReplace = { artForm = true }, enabled = enabled)
                        if (!linkedArt.hasDocument) {
                            DocPhotoButton("constancia", artPhoto, false, enabled, shootArt) { artPhoto = null }
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
                        DocPhotoButton("constancia", artPhoto, false, enabled, shootArt) { artPhoto = null }
                    }
                }

                else -> {
                    FichaCard {
                        SectionTitle("RESUMEN")
                        Text("Nombre: ${item.guestName}")
                        Text(if (item.guestDni.isNullOrBlank()) "DNI pendiente" else "DNI ${item.guestDni}")
                        Text("Ingreso: ${visitKindLabel(visitKind)} · ${arrivalModeLabel(arrivalMode)}")
                        if (req.vehicle) {
                            Text("Patente ${item.patente ?: plate.ifBlank { "—" }}")
                            Text("Seguro: ${item.insurance?.let { "${it.company ?: ""} · vence ${fmtDate(it.validUntil)}" } ?: "sin cargar"}")
                            Text("Licencia: ${item.license?.let { "vence ${fmtDate(it.validUntil)}" } ?: "sin cargar"}")
                            Text(
                                "Baúl: ${item.trunkIn?.let { t -> "${t.photoUrls.size} foto(s)${t.description?.let { " · $it" } ?: ""}" } ?: "sin revisar"}",
                            )
                        }
                        if (req.art) {
                            Text("$artLabel: ${item.personInsurance?.let { "vence ${fmtDate(it.validUntil)}" } ?: "sin cargar"}")
                        }
                        if (minorsCount > 0) Text("Menores: $minorsCount")
                        if (companions.isNotEmpty()) Text("Acompañantes: ${companions.joinToString { it.name }}")
                        if (item.phoneAuthVia == "guard_code" && !item.ownerAuthorizedByName.isNullOrBlank()) {
                            Text("Código de guardia: ${item.ownerAuthorizedByName}")
                        }
                    }
                    if (item.ownerPhone != null || item.emergencies.isNotEmpty() || item.ownerAuthorizedByName != null) {
                        FichaCard {
                            item.ownerAuthorizedByName?.let { who ->
                                Surface(shape = RoundedCornerShape(10.dp), color = MaterialTheme.colorScheme.tertiaryContainer, modifier = Modifier.fillMaxWidth()) {
                                    Text(
                                        "Autorizó el lote: $who",
                                        style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold),
                                        color = MaterialTheme.colorScheme.onTertiaryContainer,
                                        modifier = Modifier.padding(12.dp),
                                    )
                                }
                            }
                            SectionTitle("CONTACTOS Y COMUNICACIÓN")
                            item.ownerPhone?.let { phone ->
                                Button(
                                    onClick = { ctx.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$phone"))) },
                                    modifier = Modifier.fillMaxWidth().height(48.dp),
                                    shape = RoundedCornerShape(12.dp),
                                    colors = ButtonDefaults.buttonColors(
                                        containerColor = MaterialTheme.colorScheme.secondaryContainer,
                                        contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
                                    ),
                                ) {
                                    Icon(Icons.Default.Call, contentDescription = null)
                                    Spacer(Modifier.width(8.dp))
                                    Text("Llamar al lote (${item.ownerName})", style = MaterialTheme.typography.labelLarge)
                                }
                            }
                            item.emergencies.forEach { e ->
                                OutlinedButton(
                                    onClick = { ctx.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:${e.phone}"))) },
                                    modifier = Modifier.fillMaxWidth().height(46.dp),
                                    shape = RoundedCornerShape(12.dp),
                                ) {
                                    Icon(Icons.Default.Call, contentDescription = null, modifier = Modifier.size(18.dp))
                                    Spacer(Modifier.width(8.dp))
                                    Text("${e.label}: ${e.phone}", style = MaterialTheme.typography.labelLarge)
                                }
                            }
                        }
                    }
                    if (item.needsPhoneAuth) {
                        FichaCard {
                            SectionTitle("AUTORIZACIÓN POR LLAMADA TELEFÓNICA")
                            Text(
                                "Si el titular autorizó por teléfono, ingresá tu código de guardia para confirmar.",
                                style = MaterialTheme.typography.bodyMedium,
                            )
                            OutlinedTextField(
                                value = guardCode,
                                onValueChange = { guardCode = it.filter { ch -> ch.isDigit() }.take(8) },
                                label = { Text("Código de guardia") },
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(12.dp),
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                                visualTransformation = PasswordVisualTransformation(),
                            )
                            Button(
                                onClick = { onPhoneAuth(guardCode) },
                                enabled = !busy && guardCode.length >= 4,
                                modifier = Modifier.fillMaxWidth().height(46.dp),
                                shape = RoundedCornerShape(12.dp),
                            ) { Text("Confirmar autorización de llamada", style = MaterialTheme.typography.labelLarge) }
                        }
                    }
                    FichaCard {
                        SectionTitle("OBSERVACIONES Y NOTAS")
                        OutlinedTextField(
                            value = comment,
                            onValueChange = { comment = it },
                            label = { Text("Notas de la guardia o incidencias") },
                            leadingIcon = { Icon(Icons.Default.Edit, contentDescription = null, tint = MaterialTheme.colorScheme.primary) },
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(12.dp),
                        )
                    }
                }
            }
        }
    }
}
