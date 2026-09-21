package ar.accesopro.guard

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat

/** Tokens de `apps/web/app/globals.css` (`:root` + `.ops-shell`). */
object Ap {
    val Ink = Color(0xFF0B1A28)
    val InkDeep = Color(0xFF07121C)
    val Chrome = Color(0xFF002C49)
    val Panel = Color(0xFF152433)
    val Panel2 = Color(0xFF1A2C3D)
    val Line = Color(0xFF2A4054)
    val LineSoft = Color(0xFF1E3345)
    val Accent = Color(0xFF1A9FBF)
    val AccentBright = Color(0xFF2BB8D9)
    val AccentDim = Color(0xFF0E6F88)
    val Text = Color(0xFFE8F1F6)
    val TextDim = Color(0xFFA8BBC9)
    val Muted = Color(0xFF7A93A8)
    val Ok = Color(0xFF3DCF7A)
    val Warn = Color(0xFFE8B84A)
    val Danger = Color(0xFFD94A4A)
    val Tile = Color(0xFFDCE4EA)
    val TileText = Color(0xFF2F3D4A)

    val OpsBgLight = Color(0xFFF1F5F9)
    val OpsPanelLight = Color(0xFFFFFFFF)
    val OpsAccentLight = Color(0xFF0284C7)
    val OpsMutedLight = Color(0xFF64748B)
    val OpsLineLight = Color(0xFFE2E8F0)
    val OpsTextLight = Color(0xFF0F172A)

    val OpsBgDark = Color(0xFF050D15)
    val OpsPanelDark = Color(0xFF11202E)
    val OpsPanel2Dark = Color(0xFF16283A)
    val OpsLineDark = Color(0xFF22384C)

    val InBgLight = Color(0xFFE0F2FE)
    val InFgLight = Color(0xFF0369A1)
    val OutBgLight = Color(0xFFFEF3C7)
    val OutFgLight = Color(0xFFB45309)
    val InBgDark = Color(0xFF0C2A3A)
    val InFgDark = Color(0xFF7DD3FC)
    val OutBgDark = Color(0xFF2A2210)
    val OutFgDark = Color(0xFFFBBF24)

    val DangerBgLight = Color(0xFFFEF2F2)
    val DangerFgLight = Color(0xFFB91C1C)
    val DangerBgDark = Color(0xFF3A1515)
    val WarnBgLight = Color(0xFFFFFBEB)
    val WarnBgDark = Color(0xFF2A2210)
}

@Composable
fun laneFill(out: Boolean): Color {
    val dark = isSystemInDarkTheme()
    return if (out) {
        if (dark) Ap.OutBgDark else Ap.OutBgLight
    } else {
        if (dark) Ap.InBgDark else Ap.InBgLight
    }
}

@Composable
fun laneInk(out: Boolean): Color {
    val dark = isSystemInDarkTheme()
    return if (out) {
        if (dark) Ap.OutFgDark else Ap.OutFgLight
    } else {
        if (dark) Ap.InFgDark else Ap.InFgLight
    }
}

@Composable
fun laneBar(out: Boolean): Color = if (out) Ap.Warn else if (isSystemInDarkTheme()) Ap.AccentBright else Ap.OpsAccentLight

private val DarkColors = darkColorScheme(
    primary = Ap.Accent,
    onPrimary = Color.White,
    primaryContainer = Color(0xFF0C2A3A),
    onPrimaryContainer = Ap.AccentBright,
    secondary = Ap.Warn,
    onSecondary = Ap.InkDeep,
    secondaryContainer = Ap.OutBgDark,
    onSecondaryContainer = Ap.OutFgDark,
    tertiary = Ap.Ok,
    onTertiary = Ap.InkDeep,
    tertiaryContainer = Color(0xFF052E1C),
    onTertiaryContainer = Ap.Ok,
    error = Ap.Danger,
    onError = Color.White,
    errorContainer = Ap.DangerBgDark,
    onErrorContainer = Color(0xFFF08080),
    background = Ap.OpsBgDark,
    onBackground = Ap.Text,
    surface = Ap.OpsPanelDark,
    onSurface = Ap.Text,
    surfaceVariant = Ap.OpsPanel2Dark,
    onSurfaceVariant = Ap.Muted,
    outline = Ap.OpsLineDark,
    outlineVariant = Ap.LineSoft,
    surfaceContainerLowest = Ap.InkDeep,
    surfaceContainer = Ap.OpsPanelDark,
    surfaceContainerHigh = Ap.OpsPanel2Dark,
    inversePrimary = Ap.OpsAccentLight,
)

private val LightColors = lightColorScheme(
    primary = Ap.OpsAccentLight,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFEFF6FF),
    onPrimaryContainer = Color(0xFF075985),
    secondary = Ap.OutFgLight,
    onSecondary = Color.White,
    secondaryContainer = Ap.OutBgLight,
    onSecondaryContainer = Ap.OutFgLight,
    tertiary = Color(0xFF059669),
    onTertiary = Color.White,
    tertiaryContainer = Color(0xFFECFDF5),
    onTertiaryContainer = Color(0xFF065F46),
    error = Ap.Danger,
    onError = Color.White,
    errorContainer = Ap.DangerBgLight,
    onErrorContainer = Ap.DangerFgLight,
    background = Ap.OpsBgLight,
    onBackground = Ap.OpsTextLight,
    surface = Ap.OpsPanelLight,
    onSurface = Ap.OpsTextLight,
    surfaceVariant = Color(0xFFF8FAFC),
    onSurfaceVariant = Ap.OpsMutedLight,
    outline = Ap.OpsLineLight,
    outlineVariant = Color(0xFFCBD5E1),
    surfaceContainerLowest = Color(0xFFF8FAFC),
    surfaceContainer = Ap.OpsPanelLight,
    surfaceContainerHigh = Color(0xFFF1F5F9),
    inversePrimary = Ap.Accent,
)

private val ApTypography = Typography(
    headlineSmall = TextStyle(
        fontWeight = FontWeight.SemiBold,
        fontSize = 22.sp,
        letterSpacing = (-0.3).sp,
        lineHeight = 28.sp,
    ),
    titleLarge = TextStyle(
        fontWeight = FontWeight.SemiBold,
        fontSize = 20.sp,
        letterSpacing = (-0.2).sp,
    ),
    titleMedium = TextStyle(
        fontWeight = FontWeight.SemiBold,
        fontSize = 16.sp,
        letterSpacing = (-0.15).sp,
        lineHeight = 22.sp,
    ),
    titleSmall = TextStyle(
        fontWeight = FontWeight.SemiBold,
        fontSize = 14.sp,
    ),
    bodyLarge = TextStyle(fontSize = 16.sp, lineHeight = 24.sp),
    bodyMedium = TextStyle(fontSize = 14.sp, lineHeight = 20.sp),
    bodySmall = TextStyle(fontSize = 12.sp, lineHeight = 16.sp),
    labelLarge = TextStyle(
        fontWeight = FontWeight.SemiBold,
        fontSize = 13.sp,
        letterSpacing = 0.2.sp,
    ),
    labelMedium = TextStyle(
        fontWeight = FontWeight.SemiBold,
        fontSize = 11.sp,
        letterSpacing = 0.4.sp,
    ),
    labelSmall = TextStyle(
        fontWeight = FontWeight.Bold,
        fontSize = 10.sp,
        letterSpacing = 0.8.sp,
    ),
)

private val ApShapes = Shapes(
    extraSmall = RoundedCornerShape(4.dp),
    small = RoundedCornerShape(6.dp),
    medium = RoundedCornerShape(8.dp),
    large = RoundedCornerShape(10.dp),
    extraLarge = RoundedCornerShape(12.dp),
)

@Composable
fun GuardTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = !dark
            WindowCompat.getInsetsController(window, view).isAppearanceLightNavigationBars = !dark
        }
    }
    MaterialTheme(
        colorScheme = if (dark) DarkColors else LightColors,
        typography = ApTypography,
        shapes = ApShapes,
        content = content,
    )
}
