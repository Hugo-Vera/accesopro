package ar.accesopro.guard

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

data class Emergency(val label: String, val phone: String)

data class ApprovalItem(
    val id: String,
    val passId: String,
    val sentido: String,
    val reason: String,
    val guestName: String,
    val guestDni: String?,
    val patente: String?,
    val needsTrunk: Boolean,
    val needsArt: Boolean,
    val visitKind: String,
    val missing: List<String>,
    val expiredDocs: List<String>,
    val lotNumber: String?,
    val ownerName: String,
    val ownerPhone: String?,
    val ownerAuthStatus: String,
    val goodsAlert: Boolean,
    val goodsAuthorized: Boolean,
    val goodsCallReady: Boolean,
    val needsPhoneAuth: Boolean,
    val ownerAuthorizedByName: String?,
    val emergencies: List<Emergency>,
    val qrHint: String? = null,
    val scanChannelLabel: String? = null,
    val scannedByName: String? = null,
    val approvedByName: String? = null,
    val approvedVia: String? = null,
    val phoneAuthVia: String? = null,
    val readerSentido: String? = null,
    val laneMismatch: Boolean = false,
    val minorsInCount: Int = 0,
    val minorsCount: Int = 0,
    val minorsMismatchNotified: Boolean = false,
    val minorTransferAuthorized: Boolean = false,
    val dwellLabel: String? = null,
    val companions: List<CompanionItem> = emptyList(),
)

data class CompanionItem(val name: String, val dni: String?)

data class CensusLot(
    val lotNumber: String,
    val label: String,
    val adults: Int,
    val minors: Int,
    val ownerName: String?,
    val phone: String?,
    val emergencyPhone: String?,
)

data class CensusSnapshot(
    val total: Int,
    val adults: Int,
    val minors: Int,
    val lotsWithPeople: Int,
    val lots: List<CensusLot>,
)

data class OwnerNotice(
    val id: String,
    val title: String,
    val message: String,
    val status: String,
    val kind: String,
    val decidedByName: String?,
)

data class AccessQrInfo(
    val active: Boolean,
    val payload: String?,
    val qrHint: String?,
    val validUntil: String?,
    val label: String?,
)

sealed class ScanQrResult {
    data class Visit(val item: ApprovalItem) : ScanQrResult()
    data class AccessOpened(val personName: String, val actuatorsFired: List<String>) : ScanQrResult()
    data class Denied(val message: String) : ScanQrResult()
}

data class ParsedDni(
    val dni: String,
    val firstName: String,
    val lastName: String,
    val tramite: String,
    val gender: String,
    val birthDate: String,
) {
    fun fullName(): String = "$lastName $firstName".replace(Regex("\\s+"), " ").trim()
}

data class LoginResult(
    val token: String,
    val role: String,
    val name: String,
    val capabilities: List<String>,
)

class GuardApi(
    private val lanUrl: String,
    private val cloudUrl: String,
    private var token: String,
) {
    suspend fun login(email: String, password: String): LoginResult = withContext(Dispatchers.IO) {
        val body = JSONObject().put("email", email).put("password", password)
        val json = post("/auth/login", body, auth = false)
        token = json.getString("token")
        val user = json.optJSONObject("user") ?: JSONObject()
        val caps = user.optJSONArray("capabilities") ?: JSONArray()
        LoginResult(
            token = token,
            role = user.optString("role", "guard"),
            name = user.optString("name"),
            capabilities = (0 until caps.length()).map { caps.getString(it) },
        )
    }

    suspend fun me(): LoginResult = withContext(Dispatchers.IO) {
        val json = get("/auth/me")
        val user = json.optJSONObject("user") ?: JSONObject()
        val caps = user.optJSONArray("capabilities") ?: JSONArray()
        LoginResult(
            token = token,
            role = user.optString("role", "guard"),
            name = user.optString("name"),
            capabilities = (0 until caps.length()).map { caps.getString(it) },
        )
    }

    suspend fun listNotices(): List<OwnerNotice> = withContext(Dispatchers.IO) {
        val json = get("/api/residents/me/notices")
        val arr = json.optJSONArray("notices") ?: JSONArray()
        buildList {
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                add(
                    OwnerNotice(
                        id = o.optString("id"),
                        title = o.optString("title"),
                        message = o.optString("message"),
                        status = o.optString("status"),
                        kind = o.optString("kind"),
                        decidedByName = o.optString("decidedByName").ifBlank { null },
                    ),
                )
            }
        }
    }

    suspend fun decideNotice(id: String, decision: String) = withContext(Dispatchers.IO) {
        post("/api/residents/me/notices/$id/decide", JSONObject().put("decision", decision))
        Unit
    }

    suspend fun registerPush(fcmToken: String) = withContext(Dispatchers.IO) {
        post("/api/push/register", JSONObject().put("token", fcmToken).put("platform", "android"))
        Unit
    }

    suspend fun listApprovals(): List<ApprovalItem> = withContext(Dispatchers.IO) {
        val json = get("/api/visitors/approvals")
        val arr = json.optJSONArray("items") ?: JSONArray()
        buildList {
            for (i in 0 until arr.length()) add(parseItem(arr.getJSONObject(i)))
        }
    }

    suspend fun census(): CensusSnapshot = withContext(Dispatchers.IO) {
        val json = get("/api/census")
        val lots = json.optJSONArray("lots") ?: JSONArray()
        CensusSnapshot(
            total = json.optInt("total"),
            adults = json.optInt("adults"),
            minors = json.optInt("minors"),
            lotsWithPeople = json.optInt("lotsWithPeople"),
            lots = (0 until lots.length()).map {
                val o = lots.getJSONObject(it)
                CensusLot(
                    lotNumber = o.optString("lotNumber"),
                    label = o.optString("label"),
                    adults = o.optInt("adults"),
                    minors = o.optInt("minors"),
                    ownerName = o.optString("ownerName").ifBlank { null },
                    phone = o.optString("phone").ifBlank { null },
                    emergencyPhone = o.optString("emergencyPhone").ifBlank { null },
                )
            },
        )
    }

    suspend fun panicSos() = withContext(Dispatchers.IO) {
        post("/api/alarms/panic", JSONObject().put("message", "SOS desde app de guardia").put("source", "android"))
        Unit
    }

    suspend fun decide(
        id: String,
        decision: String,
        comment: String,
        trunkChecked: Boolean,
        guestDni: String,
        company: String,
        policy: String,
        until: String,
        plate: String,
    ) = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("decision", decision)
            .put("comment", comment)
            .put("trunkChecked", trunkChecked)
            .put("guestDni", guestDni)
        post("/api/visitors/approvals/$id/decide", body)
        Unit
    }

    suspend fun phoneAuth(id: String, guardCode: String) = withContext(Dispatchers.IO) {
        post("/api/visitors/approvals/$id/phone-auth", JSONObject().put("guardCode", guardCode))
        Unit
    }

    private fun parseItem(o: JSONObject): ApprovalItem {
        val missing = o.optJSONArray("missing") ?: JSONArray()
        val em = o.optJSONArray("emergencies") ?: JSONArray()
        return ApprovalItem(
            id = o.getString("id"),
            passId = o.optString("passId"),
            sentido = o.optString("sentido"),
            reason = o.optString("reason"),
            guestName = o.optString("guestName"),
            guestDni = o.optString("guestDni").ifBlank { null },
            patente = o.optString("patente").ifBlank { null },
            needsTrunk = o.optBoolean("needsTrunk"),
            needsArt = o.optBoolean("needsArt"),
            visitKind = o.optString("visitKind"),
            missing = (0 until missing.length()).map { missing.getString(it) },
            expiredDocs = (0 until (o.optJSONArray("expiredDocs") ?: JSONArray()).length()).let { n ->
                val arr = o.optJSONArray("expiredDocs") ?: JSONArray()
                (0 until arr.length()).map { arr.getString(it) }
            },
            lotNumber = o.optString("lotNumber").ifBlank { null },
            ownerName = o.optString("ownerName"),
            ownerPhone = o.optString("ownerPhone").ifBlank { null },
            ownerAuthStatus = o.optString("ownerAuthStatus"),
            goodsAlert = o.optBoolean("goodsAlert"),
            goodsAuthorized = o.optBoolean("goodsAuthorized"),
            goodsCallReady = o.optBoolean("goodsCallReady"),
            needsPhoneAuth = o.optBoolean("needsPhoneAuth"),
            ownerAuthorizedByName = o.optString("ownerAuthorizedByName").ifBlank { null },
            emergencies = (0 until em.length()).map {
                val e = em.getJSONObject(it)
                Emergency(e.optString("label"), e.optString("phone"))
            },
            qrHint = o.optString("qrHint").ifBlank { null },
            scanChannelLabel = o.optString("scanChannelLabel").ifBlank { null },
            scannedByName = o.optString("scannedByName").ifBlank { null },
            approvedByName = o.optString("approvedByName").ifBlank { null },
            approvedVia = o.optString("approvedVia").ifBlank { null },
            phoneAuthVia = o.optString("phoneAuthVia").ifBlank { null },
            readerSentido = o.optString("readerSentido").ifBlank { null },
            laneMismatch = o.optBoolean("laneMismatch"),
            minorsInCount = o.optInt("minorsInCount"),
            minorsCount = o.optInt("minorsCount"),
            minorsMismatchNotified = o.optBoolean("minorsMismatchNotified"),
            minorTransferAuthorized = o.optBoolean("minorTransferAuthorized"),
            dwellLabel = o.optString("dwellLabel").ifBlank { null },
            companions = (0 until (o.optJSONArray("companions") ?: JSONArray()).length()).let {
                val arr = o.optJSONArray("companions") ?: JSONArray()
                (0 until arr.length()).map { i ->
                    val c = arr.getJSONObject(i)
                    CompanionItem(c.optString("name"), c.optString("dni").ifBlank { null })
                }
            },
        )
    }

    suspend fun scanQr(cardRaw: String): ScanQrResult = withContext(Dispatchers.IO) {
        val json = try {
            post("/api/visitors/approvals/scan-qr", JSONObject().put("cardRaw", cardRaw).put("scanChannel", "app"))
        } catch (e: IllegalStateException) {
            return@withContext ScanQrResult.Denied(e.message ?: "QR no autorizado")
        }
        if (json.optString("accessKind") == "access_qr") {
            val fired = json.optJSONArray("actuatorsFired") ?: JSONArray()
            return@withContext ScanQrResult.AccessOpened(
                personName = json.optString("personName").ifBlank { "vecino" },
                actuatorsFired = (0 until fired.length()).map { fired.getString(it) },
            )
        }
        if (json.optBoolean("denied")) {
            return@withContext ScanQrResult.Denied(json.optString("error", "QR vencido o no vigente"))
        }
        val item = json.optJSONObject("item") ?: return@withContext ScanQrResult.Denied("QR no autorizado")
        ScanQrResult.Visit(parseItem(item))
    }

    suspend fun getAccessQr(): AccessQrInfo = withContext(Dispatchers.IO) {
        val json = get("/api/residents/me/access-qr")
        val o = json.optJSONObject("accessQr") ?: return@withContext AccessQrInfo(false, null, null, null, null)
        AccessQrInfo(
            active = o.optBoolean("active"),
            payload = o.optString("payload").ifBlank { null },
            qrHint = o.optString("qrHint").ifBlank { null },
            validUntil = o.opt("validUntil")?.toString()?.takeIf { it != "null" && it.isNotBlank() },
            label = o.optString("label").ifBlank { null },
        )
    }

    suspend fun issueAccessQr(useDefaultHours: Boolean = false): AccessQrInfo = withContext(Dispatchers.IO) {
        val body = JSONObject()
        if (useDefaultHours) body.put("useDefaultHours", true)
        val json = post("/api/residents/me/access-qr", body)
        val o = json.optJSONObject("accessQr") ?: return@withContext getAccessQr()
        AccessQrInfo(
            active = o.optBoolean("active", true),
            payload = o.optString("payload").ifBlank { null },
            qrHint = o.optString("qrHint").ifBlank { null },
            validUntil = o.opt("validUntil")?.toString()?.takeIf { it != "null" && it.isNotBlank() },
            label = o.optString("label").ifBlank { null },
        )
    }

    suspend fun revokeAccessQr() = withContext(Dispatchers.IO) {
        post("/api/residents/me/access-qr/revoke", JSONObject())
        Unit
    }

    suspend fun parseDni(raw: String): ParsedDni? = withContext(Dispatchers.IO) {
        val json = post("/api/visitors/parse-dni", JSONObject().put("raw", raw))
        val dni = json.optString("dni").ifBlank { return@withContext null }
        ParsedDni(
            dni = dni,
            firstName = json.optString("firstName"),
            lastName = json.optString("lastName"),
            tramite = json.optString("tramite"),
            gender = json.optString("gender"),
            birthDate = json.optString("birthDate"),
        )
    }

    suspend fun documentScan(imageBase64: String): String = withContext(Dispatchers.IO) {
        val json = post("/api/visitors/document-scan", JSONObject().put("imageBase64", imageBase64))
        json.optString("imageBase64")
    }

    suspend fun saveFicha(
        id: String,
        guestDni: String,
        guestName: String,
        plate: String,
        company: String,
        policy: String,
        until: String,
        cardPhoto: String?,
        artUntil: String,
        artCompany: String,
        artPhoto: String?,
        licUntil: String,
        licNumber: String,
        licPhoto: String?,
        minorsCount: Int = 0,
        companions: List<CompanionItem> = emptyList(),
    ) = withContext(Dispatchers.IO) {
        val body = JSONObject().put("guestDni", guestDni)
        if (guestName.isNotBlank()) body.put("guestName", guestName)
        if (plate.isNotBlank()) body.put("patente", plate)
        if (company.isNotBlank() && policy.isNotBlank()) {
            val ins = JSONObject()
                .put("plate", plate)
                .put("company", company)
                .put("policyNumber", policy)
                .put("validUntil", until)
            if (!cardPhoto.isNullOrBlank()) ins.put("cardPhotoBase64", cardPhoto)
            body.put("insurance", ins)
        }
        if (artUntil.isNotBlank()) {
            val art = JSONObject().put("kind", "art").put("company", artCompany).put("validUntil", artUntil)
            if (!artPhoto.isNullOrBlank()) art.put("documentBase64", artPhoto).put("source", "scan")
            body.put("personInsurance", art)
        }
        if (licUntil.isNotBlank()) {
            val lic = JSONObject().put("validUntil", licUntil).put("licenseNumber", licNumber)
            if (!licPhoto.isNullOrBlank()) lic.put("photoBase64", licPhoto)
            body.put("driverLicense", lic)
        }
        body.put("minorsCount", minorsCount)
        if (companions.isNotEmpty()) {
            val arr = JSONArray()
            companions.forEach { c ->
                arr.put(JSONObject().put("name", c.name).put("dni", c.dni ?: ""))
            }
            body.put("companions", arr)
        }
        post("/api/visitors/approvals/$id/ficha", body)
        Unit
    }

    suspend fun setMinorsCount(id: String, count: Int) = withContext(Dispatchers.IO) {
        post("/api/visitors/approvals/$id/minors-count", JSONObject().put("count", count))
        Unit
    }

    suspend fun notifyMinorsMismatch(id: String) = withContext(Dispatchers.IO) {
        post("/api/visitors/approvals/$id/minors-mismatch", JSONObject())
        Unit
    }

    suspend fun expiredException(id: String) = withContext(Dispatchers.IO) {
        post("/api/visitors/approvals/$id/expired-exception", JSONObject())
        Unit
    }

    private fun get(path: String): JSONObject = request("GET", path, null, true)

    private fun post(path: String, body: JSONObject, auth: Boolean = true): JSONObject =
        request("POST", path, body, auth)

    private fun bases(): List<String> =
        listOf(lanUrl, cloudUrl).map { it.trim().trimEnd('/') }.filter { it.isNotBlank() }.distinct()

    private fun request(method: String, path: String, body: JSONObject?, auth: Boolean): JSONObject {
        val urls = bases()
        if (urls.isEmpty()) throw IllegalStateException("Falta la URL de la API")
        var last: Exception? = null
        urls.forEachIndexed { index, base ->
            try {
                // GET corto para probar LAN. POST de abrir espera al agent (~8 s).
                val timeout =
                    if (method == "GET" && index == 0 && urls.size > 1) 2000
                    else 20000
                return requestOnce(base, method, path, body, auth, timeout)
            } catch (e: Exception) {
                last = e
            }
        }
        throw last ?: IllegalStateException("Sin servidor")
    }

    private fun requestOnce(
        base: String,
        method: String,
        path: String,
        body: JSONObject?,
        auth: Boolean,
        timeout: Int,
    ): JSONObject {
        val url = URL(base + path)
        val conn = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = timeout
            readTimeout = timeout
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Content-Type", "application/json")
            if (auth && token.isNotBlank()) setRequestProperty("Authorization", "Bearer $token")
            if (body != null) {
                doOutput = true
                OutputStreamWriter(outputStream).use { it.write(body.toString()) }
            }
        }
        val code = conn.responseCode
        val stream = if (code in 200..299) conn.inputStream else conn.errorStream
        val text = stream?.bufferedReader()?.readText() ?: ""
        conn.disconnect()
        val json = if (text.startsWith("{")) JSONObject(text) else JSONObject().put("error", text)
        if (code !in 200..299) throw IllegalStateException(json.optString("error", "HTTP $code"))
        return json
    }
}
