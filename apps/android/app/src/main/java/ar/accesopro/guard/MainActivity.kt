package ar.accesopro.guard

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val prefs = getSharedPreferences("guard", MODE_PRIVATE)
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    GuardApp(prefs)
                }
            }
        }
    }
}

@Composable
fun GuardApp(prefs: android.content.SharedPreferences) {
    var token by remember { mutableStateOf(prefs.getString("token", "") ?: "") }
    var baseUrl by remember { mutableStateOf(prefs.getString("baseUrl", "http://192.168.190.113:8787") ?: "") }
    var email by remember { mutableStateOf("guardia@lasacacias.local") }
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var items by remember { mutableStateOf(listOf<ApprovalItem>()) }
    var selected by remember { mutableStateOf<ApprovalItem?>(null) }
    val scope = rememberCoroutineScope()
    val api = remember(baseUrl, token) { GuardApi(baseUrl, token) }

    LaunchedEffect(token) {
        if (token.isBlank()) return@LaunchedEffect
        while (true) {
            runCatching { items = api.listApprovals() }
            delay(3000)
        }
    }

    if (token.isBlank()) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("AccesoPro Guardia", style = MaterialTheme.typography.headlineSmall)
            OutlinedTextField(baseUrl, { baseUrl = it }, label = { Text("API") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(email, { email = it }, label = { Text("Email") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(password, { password = it }, label = { Text("Clave") }, modifier = Modifier.fillMaxWidth())
            if (error != null) Text(error!!, color = MaterialTheme.colorScheme.error)
            Button(onClick = {
                scope.launch {
                    runCatching {
                        val t = api.login(email, password)
                        prefs.edit().putString("token", t).putString("baseUrl", baseUrl).apply()
                        token = t
                        error = null
                    }.onFailure { error = it.message }
                }
            }) { Text("Entrar") }
        }
        return
    }

    val current = selected
    if (current != null) {
        ApprovalDetail(
            item = current,
            onBack = { selected = null },
            onDecide = { decision, comment, trunk, dni, company, policy, until, plate ->
                scope.launch {
                    runCatching {
                        api.decide(current.id, decision, comment, trunk, dni, company, policy, until, plate)
                        selected = null
                        items = api.listApprovals()
                    }.onFailure { error = it.message }
                }
            },
        )
        return
    }

    Column(Modifier.padding(16.dp)) {
        Text("Aprobaciones de visita", style = MaterialTheme.typography.titleLarge)
        Text("El QR identifica; vos abrís.", style = MaterialTheme.typography.bodySmall)
        if (error != null) Text(error!!, color = MaterialTheme.colorScheme.error)
        if (items.isEmpty()) {
            Text("Nada pendiente.", modifier = Modifier.padding(top = 24.dp))
        }
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 12.dp)) {
            items(items, key = { it.id }) { row ->
                Card(modifier = Modifier.fillMaxWidth().clickable { selected = row }) {
                    Column(Modifier.padding(12.dp)) {
                        Text(row.guestName, style = MaterialTheme.typography.titleMedium)
                        Text("${if (row.sentido == "out") "Salida" else "Entrada"} · Lote ${row.lotNumber ?: "—"}")
                        if (row.reason == "expired") Text("Pase vencido")
                    }
                }
            }
        }
        OutlinedButton(onClick = {
            prefs.edit().remove("token").apply()
            token = ""
        }, modifier = Modifier.padding(top = 16.dp)) { Text("Salir") }
    }
}

@Composable
fun ApprovalDetail(
    item: ApprovalItem,
    onBack: () -> Unit,
    onDecide: (String, String, Boolean, String, String, String, String, String) -> Unit,
) {
    val ctx = LocalContext.current
    var comment by remember { mutableStateOf("") }
    var trunk by remember { mutableStateOf(false) }
    var dni by remember { mutableStateOf(item.guestDni ?: "") }
    var plate by remember { mutableStateOf(item.patente ?: "") }
    var company by remember { mutableStateOf("") }
    var policy by remember { mutableStateOf("") }
    var until by remember { mutableStateOf("") }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(item.guestName, style = MaterialTheme.typography.headlineSmall)
        Text("${if (item.sentido == "out") "Salida" else "Entrada"} · Lote ${item.lotNumber ?: "—"}")
        if (item.reason == "expired") Text("Fuera de horario o vencido")
        if (item.missing.isNotEmpty()) Text("Falta: ${item.missing.joinToString()}")
        OutlinedTextField(dni, { dni = it }, label = { Text("DNI") }, modifier = Modifier.fillMaxWidth())
        if (item.needsTrunk) {
            OutlinedTextField(plate, { plate = it }, label = { Text("Patente") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(company, { company = it }, label = { Text("Compañía seguro") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(policy, { policy = it }, label = { Text("Póliza") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(until, { until = it }, label = { Text("Vencimiento (AAAA-MM-DD)") }, modifier = Modifier.fillMaxWidth())
            Row {
                Checkbox(trunk, { trunk = it })
                Text("Baúl revisado", modifier = Modifier.padding(top = 12.dp))
            }
        }
        OutlinedTextField(comment, { comment = it }, label = { Text("Comentario") }, modifier = Modifier.fillMaxWidth())
        item.emergencies.forEach { e ->
            OutlinedButton(onClick = {
                ctx.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:${e.phone}")))
            }) { Text("${e.label} ${e.phone}") }
        }
        item.ownerPhone?.let { phone ->
            Button(onClick = {
                ctx.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$phone")))
            }) { Text("Llamar al lote (${item.ownerName})") }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { onDecide("approved", comment, trunk, dni, company, policy, until, plate) }, modifier = Modifier.weight(1f)) {
                Text("Aprobar")
            }
            OutlinedButton(onClick = { onDecide("denied", comment, trunk, dni, company, policy, until, plate) }, modifier = Modifier.weight(1f)) {
                Text("Denegar")
            }
        }
        OutlinedButton(onClick = onBack) { Text("Volver") }
    }
}
