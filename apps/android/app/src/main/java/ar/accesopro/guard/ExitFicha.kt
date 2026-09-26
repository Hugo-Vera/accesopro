package ar.accesopro.guard

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

private fun enteredLabel(iso: String?): String? {
    val t = isoMillis(iso) ?: return null
    val mins = ((System.currentTimeMillis() - t) / 60_000).coerceAtLeast(0)
    val hhmm = fmtTime(iso)
    val ago = if (mins < 60) "$mins min" else "${mins / 60} h ${mins % 60} min"
    return "entró $hhmm (hace $ago)"
}

@Composable
private fun CheckRow(checked: Boolean, enabled: Boolean, onChange: (Boolean) -> Unit, label: @Composable RowScope.() -> Unit) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = if (checked) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceVariant,
        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable(enabled = enabled) { onChange(!checked) },
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            content = {
                Checkbox(checked = checked, onCheckedChange = { onChange(it) }, enabled = enabled)
                label()
            },
        )
    }
}

@Composable
private fun MinorsCounter(value: Int, enabled: Boolean, onChange: (Int) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        OutlinedButton(onClick = { onChange((value - 1).coerceAtLeast(0)) }, enabled = enabled) { Text("−") }
        Text("$value", style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold))
        OutlinedButton(onClick = { onChange((value + 1).coerceAtMost(20)) }, enabled = enabled) { Text("+") }
    }
}

@Composable
private fun GuardCodeRow(code: String, onCode: (String) -> Unit, enabled: Boolean, onConfirm: () -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
        OutlinedTextField(
            value = code,
            onValueChange = { onCode(it.filter { ch -> ch.isDigit() }.take(8)) },
            label = { Text("Código de guardia") },
            singleLine = true,
            modifier = Modifier.weight(1f),
            shape = RoundedCornerShape(12.dp),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
            visualTransformation = PasswordVisualTransformation(),
        )
        Button(
            onClick = onConfirm,
            enabled = enabled && code.length >= 4,
            modifier = Modifier.height(52.dp),
            shape = RoundedCornerShape(12.dp),
        ) { Text("Autorizar") }
    }
}

/** Salida y reingreso en una sola pantalla: lo que se cargó al entrar es solo lectura. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ExitFicha(
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
    val scope = rememberCoroutineScope()
    val reentry = item.reentry && item.sentido != "out"
    val key = "${item.id}:${item.sentido}:$reentry"
    val crossing = if (reentry) "out_temp" else "in"
    val guestHere = item.guestPresence == crossing
    val compsHere = item.companions.filter { it.presence == crossing && it.id != null }
    val insideNow = (if (item.guestPresence == "in") 1 else 0) + item.companions.count { it.presence == "in" }
    val tempOutNow = (if (item.guestPresence == "out_temp") 1 else 0) + item.companions.count { it.presence == "out_temp" }
    val minorsInside = item.minorsInCount
    val minorsDefault = if (reentry) item.minorsOutTemp else item.minorsCount
    val needsVehicle = item.arrivalMode == "vehiculo" || item.needsVehicle || item.needsTrunk
    val checksTrunk = item.rule?.has("baul") ?: item.needsTrunk
    val opensBarrier = item.rule?.openBarrier ?: true
    val roundTrunk = if (item.trunkThisRound) (if (reentry) item.trunkIn else item.trunkOut) else null

    var guest by remember(key) { mutableStateOf(guestHere) }
    var compIds by remember(key) { mutableStateOf(compsHere.mapNotNull { it.id }) }
    var minors by remember(key) { mutableStateOf(minorsDefault) }
    var showMinors by remember(key) { mutableStateOf(minorsDefault > 0 || minorsInside > 0) }
    var returns by remember(key) { mutableStateOf(item.returns) }
    var vehicle by remember(key) { mutableStateOf(needsVehicle && guestHere) }
    var trunkOk by remember(key) { mutableStateOf(item.trunkChecked) }
    var trunkEdit by remember(key) { mutableStateOf(false) }
    val trunkDraft = remember(key, roundTrunk?.id, roundTrunk?.photoIds, roundTrunk?.description) { TrunkDraft(roundTrunk) }
    var noteOpen by remember(key) { mutableStateOf(false) }
    var note by remember(key) { mutableStateOf("") }
    var goodsOpen by remember { mutableStateOf(false) }
    var goodsZoom by remember { mutableStateOf(false) }
    val goodsPending = item.goodsAlert && !item.goodsAuthorized && !item.goodsDenied
    var guardCode by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var localError by remember(key) { mutableStateOf<String?>(null) }
    val enabled = !busy && !saving && api != null

    val selected = (if (guest) 1 else 0) + compIds.size
    val adultsRemain = !reentry && ((guestHere && !guest) || compsHere.any { it.id !in compIds })
    val minorsMismatch = !reentry && (minors > minorsInside || (!adultsRemain && minors != minorsInside))
    val reentryExpired = if (reentry) item.expiredDocs.filter { vehicle || (it != "seguro_vehiculo" && it != "licencia") } else emptyList()
    val reentryTrunkReady = (roundTrunk != null && (!roundTrunk.description.isNullOrBlank() || roundTrunk.photoIds.isNotEmpty())) ||
        trunkDraft.description.isNotBlank() || trunkDraft.newPhotos.isNotEmpty()

    val blockReason: String? = when {
        !reentry && selected == 0 -> "Marcá quién sale"
        reentry && selected == 0 -> "Marcá quién vuelve"
        reentryExpired.isNotEmpty() -> "Documento vencido"
        !reentry && vehicle && checksTrunk && !trunkOk && !trunkDraft.dirty() -> "Falta revisar el baúl"
        reentry && vehicle && checksTrunk && !reentryTrunkReady -> "Falta revisar el baúl"
        !reentry && item.goodsAlert && item.goodsDenied -> "El lote rechazó el bien: sale sin él o denegá"
        !reentry && item.goodsAlert && !item.goodsAuthorized -> "Esperando que el lote autorice el bien"
        minorsMismatch && !item.minorsMismatchNotified -> "Avisá al lote la diferencia de menores"
        !reentry && minors > minorsInside && !item.minorTransferAuthorized -> "Esperando que el lote autorice los menores"
        else -> null
    }

    val notices = buildList {
        if (item.overstay) {
            add("Se pasó del horario autorizado (vencía ${fmtDateTime(item.validUntil)}). Sale en definitiva: para volver, el lote tiene que autorizarlo de nuevo.")
        }
        if (item.laneMismatch && !reentry) {
            add("Presentó el QR en el tótem de ${if (item.readerSentido == "out") "salida" else "ingreso"}. Se trata como salida porque ya había entrado.")
        }
    }

    fun showError(e: Throwable) {
        localError = e.message ?: "No se pudo resolver"
        if (e is ApiException) e.item?.let { api?.parseApprovalJson(it) }?.let(onItemUpdated)
    }

    fun setMode(mode: String) {
        val a = api ?: return
        scope.launch {
            saving = true
            localError = null
            runCatching { a.setCrossingMode(item.id, mode) }
                .onSuccess { fresh -> fresh?.let(onItemUpdated) }
                .onFailure { showError(it) }
            saving = false
        }
    }

    fun decide(decision: String, open: Boolean = false) {
        val a = api ?: return
        scope.launch {
            saving = true
            localError = null
            runCatching {
                if (decision == "approved" && (vehicle || trunkEdit) && trunkDraft.dirty()) {
                    a.uploadTrunk(item.id, trunkDraft.description, trunkDraft.newPhotos.toList(), trunkDraft.removed.toList())
                    if (!reentry) trunkOk = true
                }
                a.decide(
                    item.id,
                    decision,
                    note,
                    trunkOk,
                    "",
                    exitPeople = ExitPeople(guest, compIds, vehicle),
                    returns = !reentry && !item.overstay && returns,
                    minorsCount = minors,
                    open = open,
                )
            }.onSuccess { onDecided() }
                .onFailure { showError(it) }
            saving = false
        }
    }

    fun clearGoods() {
        val a = api ?: return
        scope.launch {
            saving = true
            localError = null
            runCatching { a.clearGoods(item.id) }
                .onFailure { showError(it) }
            saving = false
        }
    }

    BackHandler {
        when {
            goodsZoom -> goodsZoom = false
            goodsOpen -> goodsOpen = false
            else -> onBack()
        }
    }

    if (goodsZoom) {
        item.goodsPhotoUrl?.let { url -> FullscreenGallery(api, listOf(url), 0, "Bien que lleva") { goodsZoom = false } }
    }

    if (goodsOpen) {
        GoodsAlertDialog(
            busy = saving,
            onDismiss = { goodsOpen = false },
            onError = { localError = it },
            onSend = { description, photo ->
                val a = api
                if (a != null) {
                    scope.launch {
                        saving = true
                        runCatching { a.goodsAlert(item.id, description, photo) }
                            .onSuccess { goodsOpen = false }
                            .onFailure { showError(it) }
                        saving = false
                    }
                }
            },
        )
    }

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
                            text = "${if (reentry) "REINGRESO" else "SALIDA"} · Lote ${item.lotNumber ?: "—"} · ${item.ownerName}",
                            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, contentDescription = "Volver") }
                },
                actions = { Box(Modifier.padding(end = 8.dp)) { LaneChip(out = !reentry) } },
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
                    verticalArrangement = Arrangement.spacedBy(8.dp),
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
                        Button(
                            onClick = { decide("approved") },
                            enabled = enabled && blockReason == null,
                            modifier = Modifier.weight(1.6f).height(50.dp),
                            shape = RoundedCornerShape(12.dp),
                        ) {
                            if (busy || saving) {
                                CircularProgressIndicator(Modifier.size(20.dp), color = MaterialTheme.colorScheme.onPrimary, strokeWidth = 2.dp)
                                Spacer(Modifier.width(8.dp))
                                Text("Abriendo…")
                            } else {
                                Icon(Icons.Default.CheckCircle, contentDescription = null)
                                Spacer(Modifier.width(6.dp))
                                Text(
                                    when {
                                        opensBarrier && reentry -> "Aprobar reingreso y abrir"
                                        opensBarrier -> "Aprobar salida y abrir"
                                        reentry -> "Registrar reingreso"
                                        else -> "Registrar salida"
                                    },
                                    style = MaterialTheme.typography.labelLarge,
                                )
                            }
                        }
                    }
                    if (!opensBarrier) {
                        TextButton(
                            onClick = { decide("approved", open = true) },
                            enabled = enabled && blockReason == null,
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text("Abrir igual (registra y pulsa la barrera)") }
                    }
                    if (blockReason != null) {
                        Text(
                            blockReason,
                            style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold),
                            color = MaterialTheme.colorScheme.error,
                            textAlign = TextAlign.End,
                            modifier = Modifier.fillMaxWidth(),
                        )
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
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text(
                listOfNotNull(
                    item.guestDni?.let { "DNI $it" } ?: "Sin DNI",
                    enteredLabel(item.scannedInAt),
                ).joinToString(" · "),
                style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.SemiBold),
            )

            if (insideNow > 0 && tempOutNow > 0) {
                ChoiceGrid(
                    listOf("exit" to "Sale alguien", "reentry" to "Vuelve alguien"),
                    if (reentry) "reentry" else "exit",
                    enabled = enabled,
                ) { mode -> if ((mode == "reentry") != reentry) setMode(mode) }
            }

            if (notices.isNotEmpty()) {
                Banner(
                    title = null,
                    text = notices.joinToString("\n"),
                    container = MaterialTheme.colorScheme.tertiaryContainer,
                    onContainer = MaterialTheme.colorScheme.onTertiaryContainer,
                    icon = Icons.Default.Warning,
                )
            }

            FichaCard {
                SectionTitle("INGRESÓ CON")
                Text(
                    if (item.companions.isEmpty()) "Sin acompañantes"
                    else item.companions.joinToString(" · ") { c ->
                        buildString {
                            append(c.name)
                            c.dni?.let { append(" ($it)") }
                            if (c.presence == "out") append(" · ya salió")
                            if (c.presence == "out_temp") append(" · salió, vuelve")
                        }
                    },
                    style = MaterialTheme.typography.bodyMedium,
                )
                Text(
                    buildString {
                        append(if (minorsInside > 0) "$minorsInside menor(es) adentro" else "Sin menores adentro")
                        if (item.minorsOutTemp > 0) append(" · ${item.minorsOutTemp} afuera (vuelven)")
                        if (item.arrivalMode == "vehiculo" || needsVehicle) {
                            append(" · Vehículo")
                            item.patente?.let { append(" · $it") }
                        } else {
                            append(" · A pie")
                        }
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            if (!(guestHere && compsHere.isEmpty())) {
                FichaCard {
                    SectionTitle(if (reentry) "QUIÉN VUELVE" else "QUIÉN SALE")
                    if (guestHere) {
                        CheckRow(guest, enabled, { guest = it }) {
                            Text("${item.guestName} · titular del pase", fontWeight = FontWeight.Bold)
                        }
                    }
                    compsHere.forEach { c ->
                        val id = c.id ?: return@forEach
                        CheckRow(id in compIds, enabled, { on -> compIds = if (on) compIds + id else compIds - id }) {
                            Text(listOfNotNull(c.name, c.dni?.let { "DNI $it" }).joinToString(" · "), fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }

            if (showMinors) {
                FichaCard {
                    SectionTitle(if (reentry) "MENORES QUE VUELVEN" else "MENORES QUE SALEN")
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(if (reentry) "Salieron ${item.minorsOutTemp}" else "Salen $minors de $minorsInside")
                        MinorsCounter(minors, enabled) { minors = it }
                    }
                    if (minorsMismatch) {
                        Text(
                            if (minors > minorsInside) "Salen ${minors - minorsInside} de más."
                            else "Quedan ${minorsInside - minors} menor(es) sin un adulto de la visita.",
                            color = MaterialTheme.colorScheme.error,
                            fontWeight = FontWeight.Bold,
                        )
                        if (item.minorsMismatchNotified) {
                            Text(
                                buildString {
                                    append("Aviso enviado al lote.")
                                    if (minors > minorsInside && !item.minorTransferAuthorized) append(" Esperá autorización para abrir.")
                                    if (item.minorTransferAuthorized) append(" El lote autorizó.")
                                },
                            )
                        } else {
                            Button(
                                enabled = enabled,
                                onClick = {
                                    scope.launch {
                                        saving = true
                                        localError = null
                                        runCatching {
                                            api?.setMinorsCount(item.id, minors)
                                            api?.notifyMinorsMismatch(item.id)
                                        }.onFailure { showError(it) }
                                        saving = false
                                    }
                                },
                                shape = RoundedCornerShape(10.dp),
                            ) { Text("Avisar al lote ${item.lotNumber ?: ""}") }
                        }
                    }
                }
            } else {
                TextButton(onClick = { showMinors = true }, enabled = enabled) {
                    Text(if (reentry) "Vuelve con menores" else "Sale con menores")
                }
            }

            if (!reentry && !item.overstay) {
                FichaCard {
                    SectionTitle("¿VUELVE?")
                    ChoiceGrid(
                        listOf("final" to "Salida definitiva", "back" to "Sale y vuelve"),
                        if (returns) "back" else "final",
                        enabled = enabled,
                    ) { returns = it == "back" }
                    if (returns) {
                        Text(
                            "Al volver se reconoce con el mismo QR o DNI y no se piden los documentos de nuevo.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }

            if (needsVehicle) {
                FichaCard {
                    CheckRow(vehicle, enabled, { vehicle = it }) {
                        Text(
                            (if (reentry) "Vuelve con el vehículo" else "Sale con el vehículo") +
                                (item.patente?.let { " · $it" } ?: ""),
                            fontWeight = FontWeight.Bold,
                        )
                    }
                    if (vehicle && checksTrunk && !reentry) {
                        item.trunkIn?.let { TrunkSavedCard(api, "Baúl al ingreso", it, highlight = true) }
                        CheckRow(trunkOk, enabled, { trunkOk = it }) {
                            Text("Coincide con el ingreso", fontWeight = FontWeight.Bold)
                        }
                        if (trunkEdit || roundTrunk != null) {
                            TrunkEditor(api, roundTrunk, trunkDraft, "Baúl a la salida (opcional)", enabled) { localError = it }
                        } else {
                            TextButton(onClick = { trunkEdit = true }, enabled = enabled) { Text("Agregar foto del baúl (opcional)") }
                        }
                    }
                    if (vehicle && checksTrunk && reentry) {
                        TrunkEditor(api, roundTrunk, trunkDraft, "Baúl al volver a entrar", enabled) { localError = it }
                    }
                }
            }
            if (reentryExpired.isNotEmpty()) {
                Banner(
                    title = null,
                    text = reentryExpired.joinToString(" · ") { expiredLabel(it) } + ". " +
                        if (reentryExpired.all { it == "seguro_vehiculo" || it == "licencia" })
                            "No puede volver con el vehículo: destildá «Vuelve con el vehículo» para que pase a pie."
                        else "No puede volver a entrar.",
                    container = MaterialTheme.colorScheme.errorContainer,
                    onContainer = MaterialTheme.colorScheme.onErrorContainer,
                    icon = Icons.Default.Warning,
                )
            }

            if (!reentry) {
                FichaCard {
                    SectionTitle("¿SALE CON ALGO?")
                    if (!item.goodsAlert) {
                        OutlinedButton(
                            onClick = { goodsOpen = true },
                            enabled = enabled,
                            modifier = Modifier.fillMaxWidth().height(48.dp),
                            shape = RoundedCornerShape(12.dp),
                        ) { Text("Lleva un bien (TV, electrodoméstico, herramienta…)", textAlign = TextAlign.Center) }
                    } else {
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
                            item.goodsPhotoUrl?.let { url ->
                                RemoteImage(
                                    api,
                                    url,
                                    Modifier.size(72.dp).clip(RoundedCornerShape(10.dp)).clickable { goodsZoom = true },
                                )
                            }
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text(item.goodsDescription ?: "Bien sin descripción", fontWeight = FontWeight.Bold)
                                Text(
                                    when {
                                        item.goodsAuthorized -> "Autorizó: ${item.goodsAuthorizedByName ?: "el lote"}"
                                        item.goodsDenied -> "El lote rechazó: no puede sacarlo."
                                        item.goodsCallReady -> "El lote no contesta. Llamá y confirmá con tu código de guardia."
                                        else -> "Esperando al lote (avisado a todo el grupo familiar)."
                                    },
                                    style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
                                    color = when {
                                        item.goodsAuthorized -> MaterialTheme.colorScheme.primary
                                        item.goodsDenied -> MaterialTheme.colorScheme.error
                                        else -> MaterialTheme.colorScheme.tertiary
                                    },
                                )
                            }
                        }
                        if (goodsPending) {
                            item.ownerPhone?.let { phone ->
                                TextButton(onClick = { ctx.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$phone"))) }) {
                                    Icon(Icons.Default.Call, contentDescription = null, modifier = Modifier.size(16.dp))
                                    Spacer(Modifier.width(4.dp))
                                    Text("Llamar al lote")
                                }
                            }
                            GuardCodeRow(guardCode, { guardCode = it }, !busy) { onPhoneAuth(guardCode) }
                        }
                        if (goodsPending || item.goodsDenied) {
                            OutlinedButton(
                                onClick = { clearGoods() },
                                enabled = enabled,
                                modifier = Modifier.fillMaxWidth().height(44.dp),
                                shape = RoundedCornerShape(12.dp),
                            ) { Text("Sale sin el bien") }
                        }
                    }
                }
            }

            if (item.needsPhoneAuth && !goodsPending) {
                FichaCard {
                    SectionTitle("AUTORIZACIÓN POR LLAMADA")
                    Text("Si el titular autorizó por teléfono, confirmá con tu código de guardia.", style = MaterialTheme.typography.bodyMedium)
                    GuardCodeRow(guardCode, { guardCode = it }, !busy) { onPhoneAuth(guardCode) }
                }
            }

            Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = { noteOpen = !noteOpen }, enabled = enabled) {
                    Text(if (noteOpen) "Quitar nota" else "Agregar nota")
                }
                item.ownerPhone?.let { phone ->
                    TextButton(onClick = { ctx.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$phone"))) }) {
                        Icon(Icons.Default.Call, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Llamar al lote")
                    }
                }
            }
            if (noteOpen) {
                OutlinedTextField(
                    value = note,
                    onValueChange = { note = it },
                    label = { Text("Nota") },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                )
            }
        }
    }
}
