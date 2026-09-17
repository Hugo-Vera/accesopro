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
    val emergencies: List<Emergency>,
)

class GuardApi(private val baseUrl: String, private var token: String) {
    suspend fun login(email: String, password: String): String = withContext(Dispatchers.IO) {
        val body = JSONObject().put("email", email).put("password", password)
        val json = post("/auth/login", body, auth = false)
        token = json.getString("token")
        token
    }

    suspend fun listApprovals(): List<ApprovalItem> = withContext(Dispatchers.IO) {
        val json = get("/api/visitors/approvals")
        val arr = json.optJSONArray("items") ?: JSONArray()
        buildList {
            for (i in 0 until arr.length()) add(parseItem(arr.getJSONObject(i)))
        }
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
            emergencies = (0 until em.length()).map {
                val e = em.getJSONObject(it)
                Emergency(e.optString("label"), e.optString("phone"))
            },
        )
    }

    private fun get(path: String): JSONObject = request("GET", path, null, true)

    private fun post(path: String, body: JSONObject, auth: Boolean = true): JSONObject =
        request("POST", path, body, auth)

    private fun request(method: String, path: String, body: JSONObject?, auth: Boolean): JSONObject {
        val url = URL(baseUrl.trimEnd('/') + path)
        val conn = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 12000
            readTimeout = 12000
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
