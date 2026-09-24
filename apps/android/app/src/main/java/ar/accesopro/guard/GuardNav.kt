package ar.accesopro.guard

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun GuardNavBar(
    tab: String,
    canCensus: Boolean,
    canSos: Boolean,
    onCola: () -> Unit,
    onCenso: () -> Unit,
    onHistorial: () -> Unit,
    onSos: () -> Unit,
) {
    NavigationBar(
        containerColor = MaterialTheme.colorScheme.surface,
        tonalElevation = 3.dp,
    ) {
        NavigationBarItem(
            selected = tab == "cola",
            onClick = onCola,
            icon = { Icon(Icons.Default.Person, contentDescription = null) },
            label = { Text("Cola") },
        )
        NavigationBarItem(
            selected = tab == "censo",
            onClick = onCenso,
            enabled = true,
            icon = {
                Icon(
                    Icons.Default.Home,
                    contentDescription = null,
                    tint = if (!canCensus) MaterialTheme.colorScheme.outline
                    else if (tab == "censo") MaterialTheme.colorScheme.primary
                    else LocalContentColor.current,
                )
            },
            label = { Text("Censo") },
        )
        NavigationBarItem(
            selected = tab == "historial",
            onClick = onHistorial,
            icon = { Icon(Icons.Default.Info, contentDescription = null) },
            label = { Text("Adentro") },
        )
        NavigationBarItem(
            selected = false,
            onClick = onSos,
            icon = {
                Icon(
                    Icons.Default.Warning,
                    contentDescription = null,
                    tint = if (canSos) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.outline,
                )
            },
            label = { Text("SOS") },
        )
    }
}

@Composable
fun CensusBody(
    snapshot: CensusSnapshot?,
    error: String?,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column {
                Text("Censo", style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold))
                Text(
                    "Quién hay en el predio ahora",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            IconButton(onClick = onRefresh) {
                Icon(Icons.Default.Refresh, contentDescription = "Actualizar")
            }
        }
        if (!error.isNullOrBlank()) {
            Surface(
                color = MaterialTheme.colorScheme.errorContainer,
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(error, modifier = Modifier.padding(14.dp), color = MaterialTheme.colorScheme.onErrorContainer)
            }
        }
        if (snapshot == null) {
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            return
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            MetricCard("Total", "${snapshot.total}", Modifier.weight(1f))
            MetricCard("Lotes", "${snapshot.lotsWithPeople}", Modifier.weight(1f))
            MetricCard("Adultos", "${snapshot.adults}", Modifier.weight(1f))
            MetricCard("Menores", "${snapshot.minors}", Modifier.weight(1f), alert = snapshot.minors > 0)
        }
        Text(
            "POR LOTE",
            style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold, letterSpacing = 1.2.sp),
            color = MaterialTheme.colorScheme.primary,
        )
        LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.weight(1f)) {
            items(snapshot.lots, key = { it.lotNumber }) { lot ->
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.55f)),
                ) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(
                                "Lote ${lot.lotNumber}",
                                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                            )
                            Text(
                                "${lot.adults} ad · ${lot.minors} men",
                                style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold),
                                color = MaterialTheme.colorScheme.primary,
                            )
                        }
                        if (lot.label.isNotBlank()) {
                            Text(lot.label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Text(
                            "Titular: ${lot.ownerName ?: "—"}",
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        val ctx = LocalContext.current
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            lot.phone?.let { p ->
                                OutlinedButton(
                                    onClick = { ctx.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$p"))) },
                                    contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp),
                                ) {
                                    Icon(Icons.Default.Call, null, Modifier.size(16.dp))
                                    Spacer(Modifier.width(4.dp))
                                    Text(p, style = MaterialTheme.typography.labelMedium)
                                }
                            }
                        }
                        lot.guests.forEach { g ->
                            Text(
                                buildString {
                                    append("· ${g.name}")
                                    g.dni?.let { append(" · DNI $it") }
                                    g.patente?.let { append(" · $it") }
                                },
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun OnsiteHistoryBody(
    snapshot: CensusSnapshot?,
    error: String?,
    busy: Boolean,
    onRefresh: () -> Unit,
    onRequestExit: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val guests = snapshot?.lots?.flatMap { lot ->
        lot.guests.map { g -> Triple(lot.lotNumber, lot.label, g) }
    }.orEmpty()

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column {
                Text("Adentro", style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold))
                Text(
                    "Salida manual si el lector no responde",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            IconButton(onClick = onRefresh) {
                Icon(Icons.Default.Refresh, contentDescription = "Actualizar")
            }
        }
        if (!error.isNullOrBlank()) {
            Surface(
                color = MaterialTheme.colorScheme.errorContainer,
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(error, modifier = Modifier.padding(14.dp), color = MaterialTheme.colorScheme.onErrorContainer)
            }
        }
        if (snapshot == null) {
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            return
        }
        if (guests.isEmpty()) {
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                Text("Nadie adentro ahora", style = MaterialTheme.typography.titleMedium)
            }
            return
        }
        LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.weight(1f)) {
            items(guests, key = { it.third.passId.ifBlank { it.third.name + it.first } }) { (lot, label, g) ->
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.55f)),
                ) {
                    Column(modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(g.name, style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold))
                        Text(
                            "Lote $lot${if (label.isNotBlank()) " · $label" else ""}",
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        Text(
                            listOfNotNull(
                                g.dni?.let { "DNI $it" },
                                g.patente,
                                "${g.adults} ad / ${g.minors} men",
                            ).joinToString(" · "),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Button(
                            enabled = !busy && g.passId.isNotBlank(),
                            onClick = { onRequestExit(g.passId) },
                            modifier = Modifier.fillMaxWidth().height(48.dp),
                            shape = RoundedCornerShape(12.dp),
                        ) {
                            Text("Pedir salida", fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }
    }
}
@Composable
fun MetricCard(
    title: String,
    value: String,
    modifier: Modifier = Modifier,
    alert: Boolean = false,
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(12.dp),
        color = if (alert) MaterialTheme.colorScheme.secondaryContainer
        else MaterialTheme.colorScheme.surface,
        border = BorderStroke(
            1.dp,
            if (alert) MaterialTheme.colorScheme.secondary.copy(alpha = 0.5f)
            else MaterialTheme.colorScheme.outline.copy(alpha = 0.55f),
        ),
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 10.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(value, style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold))
            Text(title, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
