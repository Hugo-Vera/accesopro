package ar.accesopro.guard

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

enum class DniVisitMode {
    Announce,
    Checkin,
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DniIdentityScreen(
    parsed: ParsedDni,
    busy: Boolean,
    error: String?,
    history: IdentityHistory? = null,
    onAnnounce: () -> Unit,
    onCheckin: () -> Unit,
    onCancel: () -> Unit,
) {
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Identidad leída", style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold))
                        Text(
                            "DNI sin pase abierto",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
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
                .padding(16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            if (error != null) {
                Surface(
                    color = MaterialTheme.colorScheme.errorContainer,
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        error,
                        modifier = Modifier.padding(14.dp),
                        color = MaterialTheme.colorScheme.onErrorContainer,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(14.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.55f)),
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Icon(Icons.Default.Person, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                        Text(
                            parsed.fullName().ifBlank { "Sin nombre en el PDF417" },
                            style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                        )
                    }
                    HorizontalDivider()
                    IdentityRow("DNI", parsed.dni)
                    IdentityRow("Apellido", parsed.lastName.ifBlank { "—" })
                    IdentityRow("Nombre", parsed.firstName.ifBlank { "—" })
                    IdentityRow("Género", parsed.gender.ifBlank { "—" })
                    IdentityRow("Nacimiento", parsed.birthDate.ifBlank { "—" })
                    IdentityRow("Trámite", parsed.tramite.ifBlank { "—" })
                }
            }
            HistoryCard(history)
            Text(
                "Elegí cómo seguir. Anunciar avisa al lote 2 minutos. Registrar crea la visita en cola sin ese aviso.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Button(
                enabled = !busy,
                onClick = onAnnounce,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp),
                shape = RoundedCornerShape(12.dp),
            ) {
                Text("Anunciar al lote", fontWeight = FontWeight.Bold)
            }
            OutlinedButton(
                enabled = !busy,
                onClick = onCheckin,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp),
                shape = RoundedCornerShape(12.dp),
            ) {
                Text("Registrar visita", fontWeight = FontWeight.Bold)
            }
            TextButton(onClick = onCancel, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
                Text("Cancelar")
            }
        }
    }
}

@Composable
private fun HistoryCard(history: IdentityHistory?) {
    if (history == null) return
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (history.blacklisted) MaterialTheme.colorScheme.errorContainer
            else MaterialTheme.colorScheme.surface,
        ),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.55f)),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            SectionTitle("ANTECEDENTES")
            if (history.blacklisted) {
                Text(
                    "Tiene impedimento de ingreso registrado. Consultá con administración.",
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onErrorContainer,
                )
            }
            if (!history.found) {
                Text("Primera vez en el barrio: no hay documentos en archivo.", style = MaterialTheme.typography.bodyMedium)
                return@Column
            }
            val lv = history.lastVisit
            if (lv != null) {
                IdentityRow("Último ingreso", fmtDate(lv.at))
                IdentityRow("Tipo", visitKindLabel(lv.visitType))
                IdentityRow("Lote", lv.lotNumber ?: "—")
                if (!lv.patente.isNullOrBlank()) IdentityRow("Patente", lv.patente)
            }
            DocHistoryRow("ART / seguro", history.art)
            DocHistoryRow("Licencia", history.license)
        }
    }
}

@Composable
private fun DocHistoryRow(label: String, doc: DocInfo?) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(
            when {
                doc == null -> "No hay"
                doc.expired -> "Vencida ${fmtDate(doc.validUntil)}"
                else -> "Vence ${fmtDate(doc.validUntil)}"
            },
            style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.SemiBold),
            color = if (doc?.expired == true) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
        )
    }
}

@Composable
private fun IdentityRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            value,
            style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.SemiBold),
            textAlign = TextAlign.End,
            modifier = Modifier.padding(start = 12.dp),
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LotPickerScreen(
    mode: DniVisitMode,
    parsed: ParsedDni,
    api: GuardApi,
    rawPdf417: String? = null,
    history: IdentityHistory? = null,
    error: String? = null,
    onDone: (CreateVisitResult) -> Unit,
    onBack: () -> Unit,
    onError: (String?) -> Unit,
) {
    var lots by remember { mutableStateOf<List<PropertyLot>>(emptyList()) }
    var query by remember { mutableStateOf("") }
    var authorizedBy by remember { mutableStateOf("") }
    var picked by remember { mutableStateOf<PropertyLot?>(null) }
    var step by remember { mutableStateOf("lot") }
    var visitKind by remember { mutableStateOf(history?.lastVisit?.visitType?.takeIf { k -> VISIT_KINDS.any { it.first == k } } ?: "social") }
    var arrivalMode by remember { mutableStateOf("peatonal") }
    var plate by remember { mutableStateOf(history?.lastVisit?.patente ?: "") }
    var busy by remember { mutableStateOf(false) }
    var loadError by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        runCatching { lots = api.listProperties() }
            .onFailure { loadError = it.message ?: "No se pudieron cargar los lotes" }
    }

    val filtered = remember(lots, query) {
        val q = query.trim().lowercase()
        if (q.isBlank()) lots
        else lots.filter {
            it.lotNumber.lowercase().contains(q) || it.label.lowercase().contains(q)
        }
    }

    fun submit(lot: PropertyLot) {
        scope.launch {
            busy = true
            onError(null)
            runCatching {
                if (arrivalMode == "vehiculo" && plate.isBlank()) error("Cargá la patente del vehículo")
                val result = when (mode) {
                    DniVisitMode.Announce -> api.announceVisit(
                        propertyId = lot.id,
                        guestName = parsed.fullName().ifBlank { null },
                        guestDni = parsed.dni,
                        visitKind = visitKind,
                        arrivalMode = arrivalMode,
                        patente = plate,
                    )
                    DniVisitMode.Checkin -> {
                        val who = authorizedBy.trim()
                        if (who.isBlank()) error("Indicá quién autoriza la visita")
                        api.checkinVisit(parsed, lot.id, who, rawPdf417, visitKind, arrivalMode, plate)
                    }
                }
                onDone(result)
            }.onFailure { onError(it.message) }
            busy = false
        }
    }

    val lotPicked = picked
    BackHandler(enabled = step == "type") { step = "lot" }
    if (step == "type" && lotPicked != null) {
        VisitTypeScreen(
            mode = mode,
            parsed = parsed,
            lot = lotPicked,
            visitKind = visitKind,
            onVisitKind = { visitKind = it },
            arrivalMode = arrivalMode,
            onArrivalMode = { arrivalMode = it },
            plate = plate,
            onPlate = { plate = it },
            authorizedBy = authorizedBy,
            onAuthorizedBy = { authorizedBy = it },
            busy = busy,
            error = error,
            onConfirm = { submit(lotPicked) },
            onBack = { step = "lot" },
        )
        return
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            if (mode == DniVisitMode.Announce) "Anunciar al lote" else "Registrar visita",
                            style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold),
                        )
                        Text(
                            "${parsed.fullName()} · DNI ${parsed.dni}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
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
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (mode == DniVisitMode.Announce) {
                Surface(
                    color = MaterialTheme.colorScheme.tertiaryContainer,
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        "Se avisa al titular 2 minutos. La barrera la abrís vos después de que autorice (portal o código telefónico).",
                        modifier = Modifier.padding(12.dp),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onTertiaryContainer,
                    )
                }
            } else {
                Surface(
                    color = MaterialTheme.colorScheme.secondaryContainer,
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        "Queda en cola sin espera al titular. En el paso siguiente anotás el tipo de ingreso y quién autorizó (verbal).",
                        modifier = Modifier.padding(12.dp),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSecondaryContainer,
                    )
                }
            }
            history?.lastVisit?.lotNumber?.let { last ->
                Text(
                    "Última vez fue al lote $last.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                label = { Text("Buscar lote") },
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                enabled = !busy,
            )
            if (loadError != null) {
                Text(loadError!!, color = MaterialTheme.colorScheme.error)
            }
            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.weight(1f),
            ) {
                items(filtered, key = { it.id }) { lot ->
                    val selected = picked?.id == lot.id
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable(enabled = !busy) { picked = lot },
                        shape = RoundedCornerShape(12.dp),
                        colors = CardDefaults.cardColors(
                            containerColor = if (selected) MaterialTheme.colorScheme.primaryContainer
                            else MaterialTheme.colorScheme.surface,
                        ),
                        border = BorderStroke(
                            1.dp,
                            if (selected) MaterialTheme.colorScheme.primary
                            else MaterialTheme.colorScheme.outline.copy(alpha = 0.5f),
                        ),
                    ) {
                        Row(
                            modifier = Modifier.padding(14.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            Icon(Icons.Default.Home, contentDescription = null)
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    "Lote ${lot.lotNumber}",
                                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                                )
                                if (lot.label.isNotBlank()) {
                                    Text(
                                        lot.label,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                        }
                    }
                }
            }
            Button(
                enabled = !busy && picked != null,
                onClick = { if (picked != null) step = "type" },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp),
                shape = RoundedCornerShape(12.dp),
            ) {
                Text("Siguiente: tipo de ingreso", fontWeight = FontWeight.Bold)
            }
        }
    }
}

/** Paso intermedio: tipo de ingreso + medio (+ patente). Define qué documentos pide la ficha. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VisitTypeScreen(
    mode: DniVisitMode,
    parsed: ParsedDni,
    lot: PropertyLot,
    visitKind: String,
    onVisitKind: (String) -> Unit,
    arrivalMode: String,
    onArrivalMode: (String) -> Unit,
    plate: String,
    onPlate: (String) -> Unit,
    authorizedBy: String,
    onAuthorizedBy: (String) -> Unit,
    busy: Boolean,
    error: String? = null,
    onConfirm: () -> Unit,
    onBack: () -> Unit,
) {
    val req = docRequirements(visitKind, arrivalMode)
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Tipo de ingreso", style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold))
                        Text(
                            "${parsed.fullName()} · Lote ${lot.lotNumber}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, contentDescription = "Volver") }
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            if (error != null) {
                Surface(
                    color = MaterialTheme.colorScheme.errorContainer,
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(error, modifier = Modifier.padding(12.dp), color = MaterialTheme.colorScheme.onErrorContainer)
                }
            }
            SectionTitle("QUIÉN ES")
            ChoiceGrid(VISIT_KINDS, visitKind, enabled = !busy, onSelect = onVisitKind)
            SectionTitle("CÓMO LLEGA")
            ChoiceGrid(ARRIVAL_MODES, arrivalMode, enabled = !busy, onSelect = onArrivalMode)
            if (arrivalMode == "vehiculo") {
                OutlinedTextField(
                    value = plate,
                    onValueChange = { onPlate(it.uppercase().take(10)) },
                    label = { Text("Patente") },
                    singleLine = true,
                    enabled = !busy,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            Surface(
                color = MaterialTheme.colorScheme.surfaceVariant,
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("La ficha va a pedir:", fontWeight = FontWeight.Bold)
                    Text("DNI")
                    if (req.vehicle) Text("Patente, seguro del auto (con foto) y licencia (vencimiento y foto)")
                    if (req.art) Text("${artLabelFor(visitKind)} (vencimiento y constancia)")
                    if (req.trunk) Text("Revisión de baúl (descripción o fotos)")
                    Text(
                        "Un documento vencido no pasa. Seguro o licencia vencidos: puede dejar el auto afuera y entrar a pie.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            if (mode == DniVisitMode.Checkin) {
                OutlinedTextField(
                    value = authorizedBy,
                    onValueChange = onAuthorizedBy,
                    label = { Text("Quién autoriza") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !busy,
                )
            }
            Button(
                enabled = !busy &&
                    (arrivalMode != "vehiculo" || plate.isNotBlank()) &&
                    (mode == DniVisitMode.Announce || authorizedBy.isNotBlank()),
                onClick = onConfirm,
                modifier = Modifier.fillMaxWidth().height(52.dp),
                shape = RoundedCornerShape(12.dp),
            ) {
                if (busy) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(22.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.onPrimary,
                    )
                } else {
                    Text(
                        if (mode == DniVisitMode.Announce) "Anunciar" else "Registrar y abrir ficha",
                        fontWeight = FontWeight.Bold,
                    )
                }
            }
        }
    }
}
