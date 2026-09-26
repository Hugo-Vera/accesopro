package ar.accesopro.guard

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

data class Emergency(val label: String, val phone: String)

/** Quién cruza en una salida parcial o un reingreso. */
data class ExitPeople(val guest: Boolean, val companionIds: List<String>, val vehicle: Boolean)

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
    val guestBirthDate: String? = null,
    val guestAge: Int? = null,
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
    val verbalAuthorizedBy: String? = null,
    val arrivalMode: String = "peatonal",
    val needsLicense: Boolean = false,
    val needsVehicle: Boolean = false,
    val canSwitchToPedestrian: Boolean = false,
    val trunkChecked: Boolean = false,
    val insurance: DocInfo? = null,
    val personInsurance: DocInfo? = null,
    val license: DocInfo? = null,
    val onFile: DocsOnFile = DocsOnFile(),
    val trunkIn: TrunkCheck? = null,
    val trunkOut: TrunkCheck? = null,
    val validFrom: String? = null,
    val validUntil: String? = null,
    val windowState: String? = null,
    val scannedInAt: String? = null,
    /** Salida de alguien que se pasó del horario del pase: sale igual, con aviso. */
    val overstay: Boolean = false,
    /** Vuelve a entrar alguien que salió con "Sale y vuelve". */
    val reentry: Boolean = false,
    val returns: Boolean = false,
    /** in | out_temp | out */
    val guestPresence: String = "in",
    val minorsOutTemp: Int = 0,
    val trunkThisRound: Boolean = false,
    val goodsDescription: String? = null,
    val goodsPhotoUrl: String? = null,
    val goodsAuthorizedByName: String? = null,
    /** El lote rechazó el bien: no se lo lleva (o se deniega la salida). */
    val goodsDenied: Boolean = false,
)

/** Documento vinculado o en archivo (ART, seguro del auto, licencia). validUntil = AAAA-MM-DD. */
data class DocInfo(
    val id: String,
    val kind: String? = null,
    val company: String? = null,
    val policyNumber: String? = null,
    val licenseNumber: String? = null,
    val plate: String? = null,
    val validUntil: String? = null,
    val hasDocument: Boolean = false,
    val expired: Boolean = false,
)

data class DocsOnFile(
    val art: DocInfo? = null,
    val license: DocInfo? = null,
    val insurance: DocInfo? = null,
)

data class TrunkCheck(
    val id: String,
    val description: String?,
    val photoIds: List<String>,
    val photoUrls: List<String>,
    val at: String?,
    val guardName: String?,
)

data class LastVisit(
    val visitType: String,
    val arrivalMode: String?,
    val patente: String?,
    val lotNumber: String?,
    val propertyId: String?,
    val at: String?,
)

data class IdentityHistory(
    val found: Boolean,
    val blacklisted: Boolean,
    val lastVisit: LastVisit?,
    val art: DocInfo?,
    val license: DocInfo?,
    val visitCount: Int = 0,
    val overstays: Int = 0,
    val denials: Int = 0,
    val goodsDenied: Int = 0,
    val lastComment: String? = null,
) {
    val hasAlerts: Boolean get() = blacklisted || overstays > 0 || denials > 0 || goodsDenied > 0
}

/** Datos de la ficha que se guardan con "Guardar y siguiente". Campos vacíos no se mandan. */
data class FichaInput(
    val guestDni: String = "",
    val guestName: String = "",
    val visitKind: String? = null,
    val arrivalMode: String? = null,
    val plate: String = "",
    val insuranceReuseId: String? = null,
    val company: String = "",
    val policy: String = "",
    val until: String = "",
    val cardPhoto: String? = null,
    val artReuseId: String? = null,
    val artKind: String? = null,
    val artUntil: String = "",
    val artCompany: String = "",
    val artPhoto: String? = null,
    val licReuseId: String? = null,
    val licUntil: String = "",
    val licNumber: String = "",
    val licPhoto: String? = null,
    val minorsCount: Int? = null,
    val companions: List<CompanionItem>? = null,
)

/** Error de la API con la lista de faltantes/vencidos y la ficha fresca si vino. */
class ApiException(
    message: String,
    val code: Int,
    val missing: List<String> = emptyList(),
    val item: JSONObject? = null,
) : IllegalStateException(message)

data class CompanionItem(
    val name: String,
    val dni: String?,
    val id: String? = null,
    /** in | out_temp | out */
    val presence: String = "in",
)

data class CensusGuest(
    val passId: String,
    val name: String,
    val dni: String?,
    val patente: String?,
    val adults: Int,
    val minors: Int,
)

data class CensusLot(
    val lotNumber: String,
    val label: String,
    val adults: Int,
    val minors: Int,
    val ownerName: String?,
    val phone: String?,
    val emergencyPhone: String?,
    val guests: List<CensusGuest> = emptyList(),
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

data class PropertyLot(
    val id: String,
    val lotNumber: String,
    val label: String,
)

data class CreateVisitResult(
    val passId: String,
    val approvalId: String?,
    val qrPayload: String? = null,
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
                        kind = o.optString("kind"),
                        decidedByName = o.optStringOrNull("decidedByName"),
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
                val guestsArr = o.optJSONArray("guests") ?: JSONArray()
                CensusLot(
                    lotNumber = o.optString("lotNumber"),
                    label = o.optString("label"),
                    adults = o.optInt("adults"),
                    minors = o.optInt("minors"),
                    ownerName = o.optStringOrNull("ownerName"),
                    phone = o.optStringOrNull("phone"),
                    emergencyPhone = o.optStringOrNull("emergencyPhone"),
                    guests = (0 until guestsArr.length()).map { gi ->
                        val g = guestsArr.getJSONObject(gi)
                        CensusGuest(
                            passId = g.optString("passId"),
                            name = g.optString("name"),
                            dni = g.optStringOrNull("dni"),
                            patente = g.optStringOrNull("patente"),
                            adults = g.optInt("adults"),
                            minors = g.optInt("minors"),
                        )
                    },
                )
            },
        )
    }

    suspend fun requestExit(passId: String): ApprovalItem? = withContext(Dispatchers.IO) {
        val json = post("/api/visitors/passes/$passId/request-exit", JSONObject())
        val item = json.optJSONObject("item") ?: return@withContext null
        parseItem(item)
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
        exitPeople: ExitPeople? = null,
        returns: Boolean? = null,
        minorsCount: Int? = null,
    ) = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("decision", decision)
            .put("comment", comment)
            .put("trunkChecked", trunkChecked)
        if (guestDni.isNotBlank()) body.put("guestDni", guestDni)
        exitPeople?.let { p ->
            body.put(
                "exitPeople",
                JSONObject()
                    .put("guest", p.guest)
                    .put("companionIds", JSONArray().apply { p.companionIds.forEach { put(it) } })
                    .put("vehicle", p.vehicle),
            )
        }
        returns?.let { body.put("returns", it) }
        minorsCount?.let { body.put("minorsCount", it) }
        post("/api/visitors/approvals/$id/decide", body)
        Unit
    }

    /** Pase con gente adentro y gente afuera temporalmente: "exit" o "reentry". */
    suspend fun setCrossingMode(id: String, mode: String): ApprovalItem? = withContext(Dispatchers.IO) {
        val json = post("/api/visitors/approvals/$id/mode", JSONObject().put("mode", mode))
        json.optJSONObject("item")?.let { parseItem(it) }
    }

    fun parseApprovalJson(o: JSONObject): ApprovalItem = parseItem(o)

    suspend fun goodsAlert(id: String, description: String, photoBase64: String?) = withContext(Dispatchers.IO) {
        val body = JSONObject().put("description", description)
        if (!photoBase64.isNullOrBlank()) body.put("photoBase64", photoBase64)
        post("/api/visitors/approvals/$id/goods", body)
        Unit
    }

    suspend fun clearGoods(id: String) = withContext(Dispatchers.IO) {
        post("/api/visitors/approvals/$id/goods/clear", JSONObject())
        Unit
    }

    suspend fun switchToPedestrian(id: String): ApprovalItem? = withContext(Dispatchers.IO) {
        val json = post("/api/visitors/approvals/$id/pedestrian", JSONObject())
        json.optJSONObject("item")?.let { parseItem(it) }
    }

    suspend fun uploadTrunk(
        approvalId: String,
        description: String?,
        photos: List<String>,
        removeIds: List<String>,
    ): ApprovalItem? = withContext(Dispatchers.IO) {
        val body = JSONObject()
        if (description != null) body.put("description", description)
        body.put("addPhotosBase64", JSONArray().apply { photos.forEach { put(it) } })
        body.put("removePhotoIds", JSONArray().apply { removeIds.forEach { put(it) } })
        val json = post("/api/visitors/approvals/$approvalId/trunk", body)
        json.optJSONObject("item")?.let { parseItem(it) }
    }

    suspend fun searchIdentity(dni: String, excludePassId: String? = null): IdentityHistory? = withContext(Dispatchers.IO) {
        val clean = dni.filter { it.isDigit() }
        if (clean.length < 7) return@withContext null
        val q = if (excludePassId.isNullOrBlank()) "" else "&excludePassId=$excludePassId"
        val json = get("/api/visitors/search-identity?dni=$clean$q")
        if (!json.optBoolean("found")) {
            return@withContext IdentityHistory(false, false, null, null, null)
        }
        val lv = json.optJSONObject("lastVisit")
        val flags = json.optJSONObject("flags") ?: JSONObject()
        IdentityHistory(
            found = true,
            blacklisted = json.optBoolean("blacklisted"),
            visitCount = json.optInt("visitCount"),
            overstays = flags.optInt("overstays"),
            denials = flags.optInt("denials"),
            goodsDenied = flags.optInt("goodsDenied"),
            lastComment = json.optStringOrNull("lastComment"),
            lastVisit = lv?.let {
                LastVisit(
                    visitType = it.optString("visitType", "social"),
                    arrivalMode = it.optStringOrNull("arrivalMode"),
                    patente = it.optStringOrNull("patente"),
                    lotNumber = it.optStringOrNull("lotNumber"),
                    propertyId = it.optStringOrNull("propertyId"),
                    at = it.optStringOrNull("at"),
                )
            },
            art = json.optJSONObject("personInsurance")?.let { parseDoc(it) },
            license = json.optJSONObject("license")?.let { o ->
                parseDoc(o).copy(hasDocument = o.optBoolean("hasPhoto"))
            },
        )
    }

    /** Foto protegida por token (baúl). */
    suspend fun fetchImage(path: String): ByteArray = withContext(Dispatchers.IO) {
        val urls = bases()
        if (urls.isEmpty()) throw IllegalStateException("Falta la URL de la API")
        var last: Exception? = null
        for (base in urls) {
            try {
                val conn = (URL(base + path).openConnection() as HttpURLConnection).apply {
                    connectTimeout = 8000
                    readTimeout = 15000
                    if (token.isNotBlank()) setRequestProperty("Authorization", "Bearer $token")
                }
                val code = conn.responseCode
                if (code !in 200..299) {
                    conn.disconnect()
                    throw IllegalStateException("HTTP $code")
                }
                val bytes = conn.inputStream.use { it.readBytes() }
                conn.disconnect()
                return@withContext bytes
            } catch (e: Exception) {
                last = e
            }
        }
        throw last ?: IllegalStateException("Sin servidor")
    }

    private fun JSONObject.optStringOrNull(key: String): String? {
        if (!has(key) || isNull(key)) return null
        return optString(key).ifBlank { null }
    }

    private fun dateOnly(o: JSONObject, key: String): String? {
        val raw = o.optStringOrNull(key) ?: return null
        return if (raw.length >= 10 && raw[4] == '-') raw.substring(0, 10) else raw
    }

    private fun parseDoc(o: JSONObject): DocInfo = DocInfo(
        id = o.optString("id"),
        kind = o.optStringOrNull("kind"),
        company = o.optStringOrNull("company"),
        policyNumber = o.optStringOrNull("policyNumber"),
        licenseNumber = o.optStringOrNull("licenseNumber"),
        plate = o.optStringOrNull("plate"),
        validUntil = dateOnly(o, "validUntil"),
        hasDocument = o.optBoolean("hasDocument") || o.optBoolean("hasPhoto"),
        expired = o.optBoolean("expired"),
    )

    private fun parseTrunk(o: JSONObject?): TrunkCheck? {
        if (o == null) return null
        val ids = o.optJSONArray("photoIds") ?: JSONArray()
        val urls = o.optJSONArray("photoUrls") ?: JSONArray()
        return TrunkCheck(
            id = o.optString("id"),
            description = o.optStringOrNull("description"),
            photoIds = (0 until ids.length()).map { ids.getString(it) },
            photoUrls = (0 until urls.length()).map { urls.getString(it) },
            at = o.optStringOrNull("at"),
            guardName = o.optStringOrNull("guardName"),
        )
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
            guestDni = o.optStringOrNull("guestDni"),
            guestBirthDate = o.optStringOrNull("guestBirthDate"),
            guestAge = if (o.isNull("guestAge")) null else o.optInt("guestAge"),
            patente = o.optStringOrNull("patente"),
            needsTrunk = o.optBoolean("needsTrunk"),
            needsArt = o.optBoolean("needsArt"),
            visitKind = o.optString("visitKind"),
            missing = (0 until missing.length()).map { missing.getString(it) },
            expiredDocs = (0 until (o.optJSONArray("expiredDocs") ?: JSONArray()).length()).let { n ->
                val arr = o.optJSONArray("expiredDocs") ?: JSONArray()
                (0 until arr.length()).map { arr.getString(it) }
            },
            lotNumber = o.optStringOrNull("lotNumber"),
            ownerName = o.optString("ownerName"),
            ownerPhone = o.optStringOrNull("ownerPhone"),
            ownerAuthStatus = o.optString("ownerAuthStatus"),
            goodsAlert = o.optBoolean("goodsAlert"),
            goodsAuthorized = o.optBoolean("goodsAuthorized"),
            goodsCallReady = o.optBoolean("goodsCallReady"),
            needsPhoneAuth = o.optBoolean("needsPhoneAuth"),
            ownerAuthorizedByName = o.optStringOrNull("ownerAuthorizedByName"),
            emergencies = (0 until em.length()).map {
                val e = em.getJSONObject(it)
                Emergency(e.optString("label"), e.optString("phone"))
            },
            qrHint = o.optStringOrNull("qrHint"),
            scanChannelLabel = o.optStringOrNull("scanChannelLabel"),
            scannedByName = o.optStringOrNull("scannedByName"),
            approvedByName = o.optStringOrNull("approvedByName"),
            approvedVia = o.optStringOrNull("approvedVia"),
            phoneAuthVia = o.optStringOrNull("phoneAuthVia"),
            readerSentido = o.optStringOrNull("readerSentido"),
            laneMismatch = o.optBoolean("laneMismatch"),
            minorsInCount = o.optInt("minorsInCount"),
            minorsCount = o.optInt("minorsCount"),
            minorsMismatchNotified = o.optBoolean("minorsMismatchNotified"),
            minorTransferAuthorized = o.optBoolean("minorTransferAuthorized"),
            dwellLabel = o.optStringOrNull("dwellLabel"),
            companions = (0 until (o.optJSONArray("companions") ?: JSONArray()).length()).let {
                val arr = o.optJSONArray("companions") ?: JSONArray()
                (0 until arr.length()).map { i ->
                    val c = arr.getJSONObject(i)
                    CompanionItem(
                        c.optString("name"),
                        c.optStringOrNull("dni"),
                        id = c.optStringOrNull("id"),
                        presence = c.optString("presence").ifBlank { "in" },
                    )
                }
            },
            verbalAuthorizedBy = o.optStringOrNull("verbalAuthorizedBy"),
            arrivalMode = o.optString("arrivalMode").ifBlank { "peatonal" },
            needsLicense = o.optBoolean("needsLicense"),
            needsVehicle = o.optBoolean("needsVehicle", o.optBoolean("needsTrunk")),
            canSwitchToPedestrian = o.optBoolean("canSwitchToPedestrian"),
            trunkChecked = o.optBoolean("trunkChecked"),
            insurance = o.optJSONObject("insurance")?.let { parseDoc(it) },
            personInsurance = o.optJSONObject("personInsurance")?.let { parseDoc(it) },
            license = o.optJSONObject("license")?.let { parseDoc(it) },
            onFile = o.optJSONObject("onFile")?.let { f ->
                DocsOnFile(
                    art = f.optJSONObject("art")?.let { parseDoc(it) },
                    license = f.optJSONObject("license")?.let { parseDoc(it) },
                    insurance = f.optJSONObject("insurance")?.let { parseDoc(it) },
                )
            } ?: DocsOnFile(),
            trunkIn = parseTrunk(o.optJSONObject("trunkIn")),
            trunkOut = parseTrunk(o.optJSONObject("trunkOut")),
            validFrom = o.optStringOrNull("validFrom"),
            validUntil = o.optStringOrNull("validUntil"),
            windowState = o.optStringOrNull("windowState"),
            scannedInAt = o.optStringOrNull("scannedInAt"),
            overstay = o.optBoolean("overstay"),
            reentry = o.optBoolean("reentry"),
            returns = o.optBoolean("returns"),
            guestPresence = o.optString("guestPresence").ifBlank { "in" },
            minorsOutTemp = o.optInt("minorsOutTemp"),
            trunkThisRound = o.optBoolean("trunkThisRound"),
            goodsDescription = o.optStringOrNull("goodsDescription"),
            goodsPhotoUrl = o.optStringOrNull("goodsPhotoUrl"),
            goodsAuthorizedByName = o.optStringOrNull("goodsAuthorizedByName"),
            goodsDenied = o.optBoolean("goodsDenied"),
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
            payload = o.optStringOrNull("payload"),
            qrHint = o.optStringOrNull("qrHint"),
            validUntil = o.opt("validUntil")?.toString()?.takeIf { it != "null" && it.isNotBlank() },
            label = o.optStringOrNull("label"),
        )
    }

    suspend fun issueAccessQr(useDefaultHours: Boolean = false): AccessQrInfo = withContext(Dispatchers.IO) {
        val body = JSONObject()
        if (useDefaultHours) body.put("useDefaultHours", true)
        val json = post("/api/residents/me/access-qr", body)
        val o = json.optJSONObject("accessQr") ?: return@withContext getAccessQr()
        AccessQrInfo(
            active = o.optBoolean("active", true),
            payload = o.optStringOrNull("payload"),
            qrHint = o.optStringOrNull("qrHint"),
            validUntil = o.opt("validUntil")?.toString()?.takeIf { it != "null" && it.isNotBlank() },
            label = o.optStringOrNull("label"),
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

    suspend fun listProperties(): List<PropertyLot> = withContext(Dispatchers.IO) {
        val json = get("/api/visitors/properties")
        val arr = json.optJSONArray("properties") ?: JSONArray()
        buildList {
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                add(
                    PropertyLot(
                        id = o.getString("id"),
                        lotNumber = o.optString("lotNumber"),
                        label = o.optString("label"),
                    ),
                )
            }
        }
    }

    suspend fun announceVisit(
        propertyId: String,
        guestName: String?,
        guestDni: String?,
        visitKind: String = "social",
        arrivalMode: String = "peatonal",
        patente: String = "",
        guestBirthDate: String = "",
    ): CreateVisitResult =
        withContext(Dispatchers.IO) {
            val body = JSONObject()
                .put("propertyId", propertyId)
                .put("visitKind", visitKind)
                .put("arrivalMode", arrivalMode)
            if (!guestName.isNullOrBlank()) body.put("guestName", guestName)
            if (!guestDni.isNullOrBlank()) body.put("guestDni", guestDni)
            if (guestBirthDate.isNotBlank()) body.put("guestBirthDate", guestBirthDate)
            if (arrivalMode == "vehiculo" && patente.isNotBlank()) body.put("patente", patente.trim().uppercase())
            val json = post("/api/visitors/announce", body)
            CreateVisitResult(
                passId = json.optString("passId"),
                approvalId = json.optStringOrNull("approvalId"),
            )
        }

    /** Check-in mínimo (identidad + lote + quién autoriza). Docs van en la ficha. */
    suspend fun checkinVisit(
        parsed: ParsedDni,
        propertyId: String,
        authorizedBy: String,
        rawPdf417: String? = null,
        visitKind: String = "social",
        arrivalMode: String = "peatonal",
        patente: String = "",
    ): CreateVisitResult = withContext(Dispatchers.IO) {
        val identity = JSONObject()
            .put("dniNumber", parsed.dni)
            .put("lastName", parsed.lastName.ifBlank { "—" })
            .put("firstName", parsed.firstName.ifBlank { "—" })
        if (parsed.tramite.isNotBlank()) identity.put("tramiteNumber", parsed.tramite)
        if (parsed.gender.isNotBlank()) identity.put("gender", parsed.gender)
        if (parsed.birthDate.isNotBlank()) identity.put("birthDate", parsed.birthDate)
        if (!rawPdf417.isNullOrBlank()) identity.put("rawPdf417", rawPdf417)
        val destination = JSONObject()
            .put("propertyId", propertyId)
            .put("authorizedBy", authorizedBy.trim())
            .put("visitType", visitKind)
        val vehicular = arrivalMode == "vehiculo"
        val body = JSONObject()
            .put("identity", identity)
            .put("destination", destination)
            .put("isVehicular", vehicular)
            .put("arrivalMode", arrivalMode)
            .put("accessMethod", "qr")
        if (vehicular && patente.isNotBlank()) {
            body.put("vehicle", JSONObject().put("plate", patente.trim().uppercase()))
        }
        val json = post("/api/visitors/checkin", body)
        CreateVisitResult(
            passId = json.optString("passId"),
            approvalId = json.optStringOrNull("approvalId"),
            qrPayload = json.optStringOrNull("qrPayload"),
        )
    }

    suspend fun documentScan(imageBase64: String): String = withContext(Dispatchers.IO) {
        val json = post("/api/visitors/document-scan", JSONObject().put("imageBase64", imageBase64))
        json.optString("imageBase64")
    }

    suspend fun saveFicha(id: String, f: FichaInput): ApprovalItem? = withContext(Dispatchers.IO) {
        val body = JSONObject()
        if (f.guestDni.isNotBlank()) body.put("guestDni", f.guestDni)
        if (f.guestName.isNotBlank()) body.put("guestName", f.guestName)
        f.visitKind?.let { body.put("visitKind", it) }
        f.arrivalMode?.let { body.put("arrivalMode", it) }
        if (f.plate.isNotBlank()) body.put("patente", f.plate.trim().uppercase())
        if (!f.insuranceReuseId.isNullOrBlank()) {
            val ins = JSONObject().put("reuseId", f.insuranceReuseId)
            if (!f.cardPhoto.isNullOrBlank()) ins.put("cardPhotoBase64", f.cardPhoto)
            body.put("insurance", ins)
        } else if ((f.company.isNotBlank() && f.policy.isNotBlank()) || !f.cardPhoto.isNullOrBlank()) {
            val ins = JSONObject().put("plate", f.plate)
            if (f.company.isNotBlank()) ins.put("company", f.company)
            if (f.policy.isNotBlank()) ins.put("policyNumber", f.policy)
            if (f.until.isNotBlank()) ins.put("validUntil", f.until)
            if (!f.cardPhoto.isNullOrBlank()) ins.put("cardPhotoBase64", f.cardPhoto)
            body.put("insurance", ins)
        }
        if (!f.artReuseId.isNullOrBlank()) {
            body.put("personInsurance", JSONObject().put("reuseId", f.artReuseId))
        } else if (f.artUntil.isNotBlank() || !f.artPhoto.isNullOrBlank()) {
            val art = JSONObject()
            f.artKind?.let { art.put("kind", it) }
            if (f.artCompany.isNotBlank()) art.put("company", f.artCompany)
            if (f.artUntil.isNotBlank()) art.put("validUntil", f.artUntil)
            if (!f.artPhoto.isNullOrBlank()) art.put("documentBase64", f.artPhoto).put("source", "scan")
            body.put("personInsurance", art)
        }
        if (!f.licReuseId.isNullOrBlank()) {
            val lic = JSONObject().put("reuseId", f.licReuseId)
            body.put("driverLicense", lic)
        } else if (f.licUntil.isNotBlank() || !f.licPhoto.isNullOrBlank()) {
            val lic = JSONObject()
            if (f.licUntil.isNotBlank()) lic.put("validUntil", f.licUntil)
            if (f.licNumber.isNotBlank()) lic.put("licenseNumber", f.licNumber)
            if (!f.licPhoto.isNullOrBlank()) lic.put("photoBase64", f.licPhoto)
            body.put("driverLicense", lic)
        }
        f.minorsCount?.let { body.put("minorsCount", it) }
        f.companions?.let { list ->
            val arr = JSONArray()
            list.forEach { c -> arr.put(JSONObject().put("name", c.name).put("dni", c.dni ?: "")) }
            body.put("companions", arr)
        }
        val json = post("/api/visitors/approvals/$id/ficha", body)
        json.optJSONObject("item")?.let { parseItem(it) }
    }

    suspend fun setMinorsCount(id: String, count: Int) = withContext(Dispatchers.IO) {
        post("/api/visitors/approvals/$id/minors-count", JSONObject().put("count", count))
        Unit
    }

    suspend fun notifyMinorsMismatch(id: String) = withContext(Dispatchers.IO) {
        post("/api/visitors/approvals/$id/minors-mismatch", JSONObject())
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
            } catch (e: ApiException) {
                // El server respondió con un error de negocio: probar la otra URL no cambia nada.
                if (e.code in 400..499) throw e
                last = e
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
        val isJson = text.startsWith("{")
        val json = if (isJson) JSONObject(text) else JSONObject().put("error", text)
        if (code !in 200..299) {
            val msg = json.optString("error", "HTTP $code")
            if (!isJson) throw IllegalStateException(msg)
            val arr = json.optJSONArray("missing") ?: JSONArray()
            throw ApiException(
                message = msg,
                code = code,
                missing = (0 until arr.length()).map { arr.getString(it) },
                item = json.optJSONObject("item"),
            )
        }
        return json
    }
}
