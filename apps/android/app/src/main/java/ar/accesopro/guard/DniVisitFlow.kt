package ar.accesopro.guard

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
    onDone: (CreateVisitResult) -> Unit,
    onBack: () -> Unit,
    onError: (String?) -> Unit,
) {
    var lots by remember { mutableStateOf<List<PropertyLot>>(emptyList()) }
    var query by remember { mutableStateOf("") }
    var authorizedBy by remember { mutableStateOf("") }
    var picked by remember { mutableStateOf<PropertyLot?>(null) }
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
                val result = when (mode) {
                    DniVisitMode.Announce -> api.announceVisit(
                        propertyId = lot.id,
                        guestName = parsed.fullName().ifBlank { null },
                        guestDni = parsed.dni,
                    )
                    DniVisitMode.Checkin -> {
                        val who = authorizedBy.trim()
                        if (who.isBlank()) error("Indicá quién autoriza la visita")
                        api.checkinVisit(parsed, lot.id, who, rawPdf417)
                    }
                }
                onDone(result)
            }.onFailure { onError(it.message) }
            busy = false
        }
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
                        "Queda en cola sin aviso de 2 minutos. Completá ficha y aprobá vos.",
                        modifier = Modifier.padding(12.dp),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSecondaryContainer,
                    )
                }
                OutlinedTextField(
                    value = authorizedBy,
                    onValueChange = { authorizedBy = it },
                    label = { Text("Quién autoriza") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !busy,
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
                enabled = !busy && picked != null && (mode == DniVisitMode.Announce || authorizedBy.isNotBlank()),
                onClick = { picked?.let { submit(it) } },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp),
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
