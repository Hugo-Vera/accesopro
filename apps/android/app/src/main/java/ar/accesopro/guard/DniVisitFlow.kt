package ar.accesopro.guard

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/** Resultado de la pantalla Nueva visita. approved = pasó directo (no hacía falta ningún documento). */
data class NewVisitOutcome(
    val result: CreateVisitResult,
    val guestName: String,
    val lotNumber: String,
    val approved: Boolean,
    val message: String? = null,
)

/** "Solicitar siguientes documentos": solo lo que aplica al tipo de ingreso; el DNI no se repite si ya se leyó. */
@Composable
fun RequiredDocsList(visitKind: String, arrivalMode: String, dniRead: Boolean) {
    val req = docRequirements(visitKind, arrivalMode)
    val docs = buildList {
        if (!dniRead) add("DNI")
        if (req.art) add(artLabelFor(visitKind))
        if (req.license) add("Licencia")
        if (req.vehicle) add("Seguro del vehículo")
        if (req.trunk) add("Revisión de baúl")
    }
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant,
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            if (docs.isEmpty()) {
                Text("No hace falta pedir otros documentos.", fontWeight = FontWeight.Bold)
            } else {
                Text("Solicitar siguientes documentos:", fontWeight = FontWeight.Bold)
                docs.forEach { Text("·  $it", style = MaterialTheme.typography.bodyLarge) }
            }
        }
    }
}

/** Antecedentes del DNI en el barrio. Resaltado si ya vino y en rojo si hay marcas (bloqueo, rechazos, fuera de horario). */
@Composable
fun HistoryCard(history: IdentityHistory?, compact: Boolean = false) {
    if (history == null) return
    if (!history.found) {
        if (!compact) {
            Text(
                "Primera vez en el barrio.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        return
    }
    val alert = history.hasAlerts
    val container = if (alert) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.tertiaryContainer
    val ink = if (alert) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.onTertiaryContainer
    Surface(color = container, shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(if (alert) Icons.Default.Warning else Icons.Default.Info, contentDescription = null, tint = ink, modifier = Modifier.size(20.dp))
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                val lv = history.lastVisit
                val count = history.visitCount
                Text(
                    when {
                        count > 1 -> "Ya vino $count veces"
                        count == 1 -> "Ya vino 1 vez"
                        else -> "Tiene antecedentes en el barrio"
                    },
                    fontWeight = FontWeight.Bold,
                    color = ink,
                )
                if (lv?.at != null) {
                    Text(
                        listOfNotNull(
                            "Último ingreso ${fmtDateTime(lv.at)}",
                            lv.lotNumber?.let { "lote $it" },
                            visitKindLabel(lv.visitType),
                            lv.patente,
                        ).joinToString(" · "),
                        style = MaterialTheme.typography.bodyMedium,
                        color = ink,
                    )
                }
                if (history.blacklisted) {
                    Text("Tiene impedimento de ingreso. Consultá con administración.", fontWeight = FontWeight.Bold, color = ink)
                }
                if (history.denials > 0) {
                    Text("Ingreso denegado ${history.denials} ${if (history.denials == 1) "vez" else "veces"}", fontWeight = FontWeight.SemiBold, color = ink)
                }
                if (history.overstays > 0) {
                    Text("Se pasó del horario ${history.overstays} ${if (history.overstays == 1) "vez" else "veces"}", fontWeight = FontWeight.SemiBold, color = ink)
                }
                if (history.goodsDenied > 0) {
                    Text("Intentó sacar un bien sin autorización", fontWeight = FontWeight.SemiBold, color = ink)
                }
                if (!compact) {
                    history.lastComment?.let {
                        Text("Nota: $it", style = MaterialTheme.typography.bodySmall, color = ink, maxLines = 3)
                    }
                    history.art?.let { DocHistoryLine(artLabelFor("service"), it, ink) }
                    history.license?.let { DocHistoryLine("Licencia", it, ink) }
                }
            }
        }
    }
}

@Composable
private fun DocHistoryLine(label: String, doc: DocInfo, ink: androidx.compose.ui.graphics.Color) {
    Text(
        "$label en archivo: ${if (doc.expired) "vencida ${fmtDate(doc.validUntil)}" else "vence ${fmtDate(doc.validUntil)}"}",
        style = MaterialTheme.typography.bodySmall,
        color = if (doc.expired) MaterialTheme.colorScheme.error else ink,
    )
}

private val AUTHORIZED_BY_QUICK = listOf("Titular", "Familiar", "Administración")

/**
 * DNI sin pase: identidad (editable con el lápiz), antecedentes, lote, tipo de ingreso y documentos en una sola pantalla.
 * Si no hace falta ningún documento más que el DNI, "Registrar y dejar pasar" aprueba y abre en el mismo toque.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewVisitScreen(
    initial: ParsedDni,
    api: GuardApi,
    rawPdf417: String?,
    onDone: (NewVisitOutcome) -> Unit,
    onBack: () -> Unit,
) {
    var parsed by remember { mutableStateOf(initial) }
    var editing by remember { mutableStateOf(initial.lastName.isBlank() && initial.firstName.isBlank()) }
    var eLast by remember { mutableStateOf(initial.lastName) }
    var eFirst by remember { mutableStateOf(initial.firstName) }
    var eDni by remember { mutableStateOf(initial.dni) }
    var eGender by remember { mutableStateOf(initial.gender) }
    var eBirth by remember { mutableStateOf(initial.birthDate) }
    var history by remember { mutableStateOf<IdentityHistory?>(null) }
    var lots by remember { mutableStateOf<List<PropertyLot>>(emptyList()) }
    var query by remember { mutableStateOf("") }
    var picked by remember { mutableStateOf<PropertyLot?>(null) }
    var lotAuto by remember { mutableStateOf(false) }
    var visitKind by remember { mutableStateOf("social") }
    var arrivalMode by remember { mutableStateOf("peatonal") }
    var plate by remember { mutableStateOf("") }
    var authorizedBy by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var typeTouched by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        runCatching { lots = api.listProperties() }
            .onFailure { error = it.message ?: "No se pudieron cargar los lotes" }
    }
    LaunchedEffect(parsed.dni) {
        history = null
        history = runCatching { api.searchIdentity(parsed.dni) }.getOrNull()
    }
    LaunchedEffect(history, lots) {
        val lv = history?.lastVisit ?: return@LaunchedEffect
        if (picked == null && lv.propertyId != null) {
            lots.find { it.id == lv.propertyId }?.let { picked = it; lotAuto = true }
        }
        if (!typeTouched) {
            lv.visitType.takeIf { k -> VISIT_KINDS.any { it.first == k } }?.let { visitKind = it }
            if (lv.arrivalMode == "vehiculo") {
                arrivalMode = "vehiculo"
                if (plate.isBlank()) plate = lv.patente ?: ""
            }
        }
    }

    val req = docRequirements(visitKind, arrivalMode)
    val needsDocs = req.art || req.vehicle
    val direct = !needsDocs && history?.hasAlerts != true

    BackHandler {
        if (editing && parsed.dni.isNotBlank()) editing = false else onBack()
    }

    fun validate(requireAuthorizer: Boolean): PropertyLot? {
        val lot = picked
        error = when {
            parsed.dni.filter { it.isDigit() }.length < 7 -> "Falta el DNI"
            editing -> "Guardá o cancelá la edición de la identidad"
            lot == null -> "Elegí el lote"
            arrivalMode == "vehiculo" && plate.isBlank() -> "Cargá la patente del vehículo"
            requireAuthorizer && authorizedBy.isBlank() -> "Indicá quién autoriza"
            else -> null
        }
        return if (error == null) lot else null
    }

    fun announce() {
        val lot = validate(requireAuthorizer = false) ?: return
        scope.launch {
            busy = true
            runCatching {
                api.announceVisit(
                    propertyId = lot.id,
                    guestName = parsed.fullName().ifBlank { null },
                    guestDni = parsed.dni,
                    visitKind = visitKind,
                    arrivalMode = arrivalMode,
                    patente = plate,
                )
            }.onSuccess { onDone(NewVisitOutcome(it, parsed.fullName(), lot.lotNumber, approved = false)) }
                .onFailure { error = it.message }
            busy = false
        }
    }

    fun register() {
        val lot = validate(requireAuthorizer = true) ?: return
        scope.launch {
            busy = true
            runCatching {
                val result = api.checkinVisit(parsed, lot.id, authorizedBy.trim(), rawPdf417, visitKind, arrivalMode, plate)
                val approvalId = result.approvalId
                if (!direct || approvalId == null) {
                    return@runCatching NewVisitOutcome(result, parsed.fullName(), lot.lotNumber, approved = false)
                }
                val decided = runCatching { api.decide(approvalId, "approved", "", false, parsed.dni) }
                NewVisitOutcome(
                    result,
                    parsed.fullName(),
                    lot.lotNumber,
                    approved = decided.isSuccess,
                    message = decided.exceptionOrNull()?.message,
                )
            }.onSuccess(onDone)
                .onFailure { error = it.message }
            busy = false
        }
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = { Text("Nueva visita", style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold)) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, contentDescription = "Volver") }
                },
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
                    error?.let {
                        Text(it, color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.SemiBold)
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                        OutlinedButton(
                            onClick = { announce() },
                            enabled = !busy,
                            modifier = Modifier.weight(1f).height(54.dp),
                            shape = RoundedCornerShape(12.dp),
                        ) { Text("Anunciar al lote", fontWeight = FontWeight.Bold) }
                        Button(
                            onClick = { register() },
                            enabled = !busy,
                            modifier = Modifier.weight(1.4f).height(54.dp),
                            shape = RoundedCornerShape(12.dp),
                        ) {
                            if (busy) {
                                CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                            } else {
                                Text(if (direct) "Registrar y dejar pasar" else "Registrar y abrir ficha", fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
            }
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            // Identidad: nombre resaltado; el lápiz abre los campos para corregir una lectura errónea.
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(14.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
            ) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(
                                parsed.fullName().ifBlank { "Sin nombre" },
                                style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.Bold),
                                color = MaterialTheme.colorScheme.onPrimaryContainer,
                            )
                            Text(
                                listOfNotNull(
                                    "DNI ${parsed.dni.ifBlank { "—" }}",
                                    parsed.gender.ifBlank { null },
                                    parsed.birthDate.ifBlank { null }?.let { "nac. ${fmtDate(it)}" },
                                ).joinToString(" · "),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onPrimaryContainer,
                            )
                        }
                        if (!editing) {
                            IconButton(onClick = {
                                eLast = parsed.lastName
                                eFirst = parsed.firstName
                                eDni = parsed.dni
                                eGender = parsed.gender
                                eBirth = parsed.birthDate
                                editing = true
                            }) {
                                Icon(Icons.Default.Edit, contentDescription = "Editar identidad", tint = MaterialTheme.colorScheme.onPrimaryContainer)
                            }
                        }
                    }
                    if (editing) {
                        val fieldColors = OutlinedTextFieldDefaults.colors(
                            focusedContainerColor = MaterialTheme.colorScheme.surface,
                            unfocusedContainerColor = MaterialTheme.colorScheme.surface,
                        )
                        OutlinedTextField(
                            value = eLast,
                            onValueChange = { eLast = it.uppercase() },
                            label = { Text("Apellido") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                            colors = fieldColors,
                        )
                        OutlinedTextField(
                            value = eFirst,
                            onValueChange = { eFirst = it.uppercase() },
                            label = { Text("Nombres") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                            colors = fieldColors,
                        )
                        OutlinedTextField(
                            value = eDni,
                            onValueChange = { eDni = it.filter { ch -> ch.isDigit() }.take(9) },
                            label = { Text("DNI") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                            modifier = Modifier.fillMaxWidth(),
                            colors = fieldColors,
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text("Sexo", color = MaterialTheme.colorScheme.onPrimaryContainer)
                            listOf("M", "F", "X").forEach { g ->
                                FilterChip(selected = eGender == g, onClick = { eGender = if (eGender == g) "" else g }, label = { Text(g) })
                            }
                        }
                        DateField("Nacimiento", eBirth, { eBirth = it })
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            if (parsed.dni.isNotBlank()) {
                                OutlinedButton(onClick = { editing = false }, shape = RoundedCornerShape(10.dp)) { Text("Cancelar") }
                            }
                            Button(
                                onClick = {
                                    parsed = parsed.copy(
                                        lastName = eLast.trim(),
                                        firstName = eFirst.trim(),
                                        dni = eDni,
                                        gender = eGender,
                                        birthDate = eBirth,
                                    )
                                    editing = false
                                    error = null
                                },
                                enabled = eDni.length >= 7 && (eLast.isNotBlank() || eFirst.isNotBlank()),
                                shape = RoundedCornerShape(10.dp),
                            ) { Text("Guardar") }
                        }
                    }
                }
            }

            HistoryCard(history)

            // Lote: preseleccionado con el de la última visita.
            SectionTitle("LOTE")
            val lot = picked
            if (lot != null) {
                Surface(
                    color = MaterialTheme.colorScheme.secondaryContainer,
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Row(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Home, contentDescription = null, tint = MaterialTheme.colorScheme.onSecondaryContainer)
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(
                                "Lote ${lot.lotNumber}",
                                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                                color = MaterialTheme.colorScheme.onSecondaryContainer,
                            )
                            val sub = listOfNotNull(lot.label.ifBlank { null }, if (lotAuto) "el de la última visita" else null).joinToString(" · ")
                            if (sub.isNotBlank()) {
                                Text(sub, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSecondaryContainer)
                            }
                        }
                        TextButton(onClick = { picked = null; lotAuto = false }, enabled = !busy) { Text("Cambiar") }
                    }
                }
            } else {
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    label = { Text("Buscar lote") },
                    leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !busy,
                )
                val q = query.trim().lowercase()
                val filtered = if (q.isBlank()) lots else lots.filter {
                    it.lotNumber.lowercase().contains(q) || it.label.lowercase().contains(q)
                }
                filtered.take(8).forEach { l ->
                    Card(
                        modifier = Modifier.fillMaxWidth().clickable(enabled = !busy) { picked = l; lotAuto = false },
                        shape = RoundedCornerShape(12.dp),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.5f)),
                    ) {
                        Row(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text("Lote ${l.lotNumber}", fontWeight = FontWeight.Bold, modifier = Modifier.width(96.dp))
                            Text(l.label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                if (filtered.size > 8) {
                    Text(
                        "${filtered.size - 8} lotes más: escribí el número para filtrar.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            SectionTitle("QUIÉN ES")
            ChoiceGrid(VISIT_KINDS, visitKind, enabled = !busy) { visitKind = it; typeTouched = true }
            SectionTitle("CÓMO LLEGA")
            ChoiceGrid(ARRIVAL_MODES, arrivalMode, enabled = !busy) { arrivalMode = it; typeTouched = true }
            if (arrivalMode == "vehiculo") {
                OutlinedTextField(
                    value = plate,
                    onValueChange = { plate = it.uppercase().filter { ch -> ch.isLetterOrDigit() }.take(10) },
                    label = { Text("Patente") },
                    singleLine = true,
                    enabled = !busy,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            RequiredDocsList(visitKind, arrivalMode, dniRead = parsed.dni.isNotBlank())

            SectionTitle("QUIÉN AUTORIZA (PARA REGISTRAR)")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                AUTHORIZED_BY_QUICK.forEach { who ->
                    FilterChip(
                        selected = authorizedBy == who,
                        onClick = { authorizedBy = if (authorizedBy == who) "" else who },
                        enabled = !busy,
                        label = { Text(who) },
                    )
                }
            }
            OutlinedTextField(
                value = authorizedBy,
                onValueChange = { authorizedBy = it },
                label = { Text("Quién autoriza") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                enabled = !busy,
            )
            Spacer(Modifier.height(8.dp))
        }
    }
}
