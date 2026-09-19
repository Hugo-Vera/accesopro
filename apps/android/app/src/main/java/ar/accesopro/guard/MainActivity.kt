package ar.accesopro.guard

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.TextButton
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.tooling.preview.Preview
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
    var baseUrl by remember { mutableStateOf(prefs.getString("baseUrl", "http://192.168.190.114:8787") ?: "") }
    var cloudUrl by remember { mutableStateOf(prefs.getString("cloudUrl", "") ?: "") }
    var email by remember { mutableStateOf("guardia@lasacacias.local") }
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var isLoading by remember { mutableStateOf(false) }
    var items by remember { mutableStateOf(listOf<ApprovalItem>()) }
    var selected by remember { mutableStateOf<ApprovalItem?>(null) }
    var showCensus by remember { mutableStateOf(false) }
    var census by remember { mutableStateOf<CensusSnapshot?>(null) }
    val scope = rememberCoroutineScope()
    val api = remember(baseUrl, cloudUrl, token) { GuardApi(baseUrl, cloudUrl, token) }

    val isPreview = LocalInspectionMode.current
    LaunchedEffect(token) {
        if (token.isBlank() || isPreview) return@LaunchedEffect
        while (true) {
            runCatching { items = api.listApprovals() }
            delay(3000)
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
                        val t = api.login(email, password)
                        prefs.edit()
                            .putString("token", t)
                            .putString("baseUrl", baseUrl)
                            .putString("cloudUrl", cloudUrl)
                            .apply()
                        token = t
                    }.onFailure {
                        error = it.message ?: "Error de conexión o credenciales inválidas"
                    }
                    isLoading = false
                }
            }
        )
        return
    }

    val current = selected
    if (showCensus) {
        CensusScreen(
            snapshot = census,
            error = error,
            onBack = { showCensus = false },
            onRefresh = {
                scope.launch {
                    runCatching { census = api.census() }.onFailure { error = it.message }
                }
            },
        )
        return
    }
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
        Text("LAN primero (2 s); si no responde, URL pública. El QR identifica; vos abrís.", style = MaterialTheme.typography.bodySmall)
        if (error != null) Text(error!!, color = MaterialTheme.colorScheme.error)
        Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = {
                scope.launch {
                    runCatching {
                        census = api.census()
                        showCensus = true
                    }.onFailure { error = it.message }
                }
            }) { Text("Censo") }
            OutlinedButton(onClick = {
                scope.launch {
                    runCatching {
                        api.panicSos()
                        error = "SOS enviado a portería"
                    }.onFailure { error = it.message }
                }
            }) { Text("SOS") }
        }
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
            .background(MaterialTheme.colorScheme.surfaceContainerLowest)
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
            // Branding Header
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Surface(
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.primaryContainer,
                    modifier = Modifier.size(80.dp)
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            imageVector = Icons.Default.Lock,
                            contentDescription = "Logo",
                            tint = MaterialTheme.colorScheme.onPrimaryContainer,
                            modifier = Modifier.size(40.dp)
                        )
                    }
                }

                Text(
                    text = "AccesoPro",
                    style = MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.Bold),
                    color = MaterialTheme.colorScheme.primary
                )
                Text(
                    text = "Control de Acceso · Guardia",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            // Form Card Container
            ElevatedCard(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(24.dp),
                colors = CardDefaults.elevatedCardColors(
                    containerColor = MaterialTheme.colorScheme.surface
                ),
                elevation = CardDefaults.elevatedCardElevation(defaultElevation = 3.dp)
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(24.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    Text(
                        text = "Iniciar Sesión",
                        style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.SemiBold),
                        color = MaterialTheme.colorScheme.onSurface
                    )

                    OutlinedTextField(
                        value = email,
                        onValueChange = onEmailChange,
                        label = { Text("Usuario / Email") },
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
                                    style = MaterialTheme.typography.labelMedium
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
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { showServerConfig = !showServerConfig }
                            .padding(vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Settings,
                                contentDescription = null,
                                modifier = Modifier.size(18.dp),
                                tint = MaterialTheme.colorScheme.outline
                            )
                            Text(
                                text = "Configuración Servidor API",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.outline
                            )
                        }
                        Icon(
                            imageVector = Icons.Default.ArrowDropDown,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.outline
                        )
                    }

                    if (showServerConfig) {
                        OutlinedTextField(
                            value = baseUrl,
                            onValueChange = onBaseUrlChange,
                            label = { Text("URL LAN (garita)") },
                            leadingIcon = {
                                Icon(
                                    imageVector = Icons.Default.Info,
                                    contentDescription = null
                                )
                            },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(12.dp)
                        )
                        OutlinedTextField(
                            value = cloudUrl,
                            onValueChange = onCloudUrlChange,
                            label = { Text("URL pública (si la LAN no responde)") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(12.dp)
                        )
                    }

                    // Error Message Container
                    if (!error.isNullOrBlank()) {
                        Surface(
                            color = MaterialTheme.colorScheme.errorContainer,
                            shape = RoundedCornerShape(12.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Row(
                                modifier = Modifier.padding(12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Warning,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.onErrorContainer
                                )
                                Text(
                                    text = error,
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onErrorContainer
                                )
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(4.dp))

                    Button(
                        onClick = {
                            keyboardController?.hide()
                            onLogin()
                        },
                        enabled = !isLoading && email.isNotBlank() && password.isNotBlank(),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(52.dp),
                        shape = RoundedCornerShape(14.dp)
                    ) {
                        if (isLoading) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(24.dp),
                                color = MaterialTheme.colorScheme.onPrimary,
                                strokeWidth = 2.5.dp
                            )
                        } else {
                            Text(
                                text = "Ingresar al Sistema",
                                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold)
                            )
                        }
                    }
                }
            }

            // Footer metadata
            Text(
                text = "AccesoPro® · Versión 0.1.0",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.outline
            )
        }
    }
}

@Composable
fun CensusScreen(
    snapshot: CensusSnapshot?,
    error: String?,
    onBack: () -> Unit,
    onRefresh: () -> Unit,
) {
    Column(Modifier.padding(16.dp).fillMaxSize(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Censo de evacuación", style = MaterialTheme.typography.titleLarge)
        if (error != null) Text(error, color = MaterialTheme.colorScheme.error)
        if (snapshot == null) {
            Text("Cargando…")
        } else {
            Text("${snapshot.total} vidas · ${snapshot.adults} adultas · ${snapshot.minors} menores · ${snapshot.lotsWithPeople} lotes")
            snapshot.lots.forEach { lot ->
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp)) {
                        Text("Lote ${lot.lotNumber} · ${lot.label}", fontWeight = FontWeight.Bold)
                        Text("${lot.adults} ad. / ${lot.minors} men. · ${lot.ownerName ?: "—"}")
                        Text("Tel. ${lot.phone ?: "—"} · emerg. ${lot.emergencyPhone ?: "—"}")
                    }
                }
            }
        }
        OutlinedButton(onClick = onRefresh) { Text("Actualizar") }
        OutlinedButton(onClick = onBack) { Text("Volver") }
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
        OutlinedTextField(
            value = dni,
            onValueChange = { dni = it },
            label = { Text("DNI (pistola HID o teclado)") },
            modifier = Modifier.fillMaxWidth(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        )
        if (item.goodsAlert) {
            Text(if (item.goodsAuthorized) "Bien autorizado por el lote" else if (item.goodsCallReady) "Sin respuesta: llamá al titular" else "Bien no registrado: barrera retenida")
        }
        if (item.needsTrunk) {
            OutlinedTextField(value = plate, onValueChange = { plate = it }, label = { Text("Patente") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = company, onValueChange = { company = it }, label = { Text("Compañía seguro") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = policy, onValueChange = { policy = it }, label = { Text("Póliza") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = until, onValueChange = { until = it }, label = { Text("Vencimiento (AAAA-MM-DD)") }, modifier = Modifier.fillMaxWidth())
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = trunk, onCheckedChange = { trunk = it })
                Text("Baúl revisado", modifier = Modifier.padding(start = 8.dp))
            }
        }
        OutlinedTextField(value = comment, onValueChange = { comment = it }, label = { Text("Comentario") }, modifier = Modifier.fillMaxWidth())
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
    MaterialTheme {
        Surface(modifier = Modifier.fillMaxSize()) {
            GuardApp(prefs = mockPrefs)
        }
    }
}

@Preview(showBackground = true)
@Composable
fun LoginScreenPreview() {
    MaterialTheme {
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
