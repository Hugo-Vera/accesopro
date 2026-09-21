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
    val missing: List<String>,
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
)

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
    val decidedByName: String?,
)

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
        if (company.isNotBlank() && policy.isNotBlank()) {
            body.put(
                "insurance",
                JSONObject()
                    .put("plate", plate)
                    .put("company", company)
                    .put("policyNumber", policy)
                    .put("validUntil", until),
            )
        }
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
            missing = (0 until missing.length()).map { missing.getString(it) },
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
        )
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
