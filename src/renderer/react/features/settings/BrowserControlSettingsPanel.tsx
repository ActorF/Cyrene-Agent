import { useEffect, useState } from "react";
import { Alert, Button, Popconfirm } from "antd";
import { Cookie, Globe, Smartphone } from "lucide-react";
import { useTranslation } from "../../i18n";
import { Card } from "../../components/ui/Card";
import { SettingsSegmented } from "../../components/ui/SettingsControls";
import {
  DEFAULT_BROWSER_VIEWPORT_MODE,
  normalizeBrowserViewportMode,
  type BrowserViewportMode,
} from "../../../../shared/browser-viewport";
import "./BrowserControlSettingsPanel.css";

export function BrowserControlSettingsPanel() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"cleared" | "failed" | "">("");
  const [viewportMode, setViewportMode] = useState<BrowserViewportMode>(DEFAULT_BROWSER_VIEWPORT_MODE);
  const [viewportModeFailed, setViewportModeFailed] = useState(false);
  // 读到已保存的模式之前禁用切换：否则较晚返回的读取会把用户刚切换并保存的值在界面上覆盖回去
  const [viewportModeLoaded, setViewportModeLoaded] = useState(false);

  useEffect(() => {
    let disposed = false;
    const api = window.settings;
    if (!api) {
      setViewportModeLoaded(true);
      return;
    }
    void api.getGeneral().then((config) => {
      if (disposed) return;
      setViewportMode(normalizeBrowserViewportMode((config as { browserViewportMode?: unknown } | null)?.browserViewportMode));
      setViewportModeLoaded(true);
    }).catch(() => {
      if (!disposed) setViewportModeLoaded(true);
    });
    return () => { disposed = true; };
  }, []);

  /** 切换即保存；保存失败时回滚，避免界面与实际生效的模式不一致。 */
  async function changeViewportMode(next: BrowserViewportMode) {
    const previous = viewportMode;
    if (next === previous) return;
    setViewportMode(next);
    setViewportModeFailed(false);
    try {
      if (!window.settings) throw new Error("Settings API unavailable");
      await window.settings.saveGeneral({ browserViewportMode: next });
    } catch {
      setViewportMode(previous);
      setViewportModeFailed(true);
    }
  }

  async function clearCookies() {
    if (!window.browserPanel || busy) return;
    setBusy(true);
    setStatus("");
    try {
      const result = await window.browserPanel.clearCookies();
      setStatus(result.ok ? "cleared" : "failed");
    } catch {
      setStatus("failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cy-browser-control-page">
      <h1>{t("settingsPage.browserControl.title")}</h1>
      <p className="cy-settings-intro">{t("settingsPage.browserControl.description")}</p>
      <section className="cy-settings-section">
        <div className="cy-settings-section__heading">
          <h2><Globe size={18} />{t("settingsPage.browserControl.sectionTitle")}</h2>
          <p>{t("settingsPage.browserControl.sectionDescription")}</p>
        </div>
        <Card>
          <div className="cy-settings-row">
            <div className="cy-settings-row__copy">
              <strong><Smartphone size={16} />{t("settingsPage.browserControl.viewportMode")}</strong>
              <span>{t(viewportMode === "auto" ? "settingsPage.browserControl.viewportModeAutoDescription" : "settingsPage.browserControl.viewportModeCustomDescription")}</span>
            </div>
            <SettingsSegmented
              value={viewportMode}
              disabled={!viewportModeLoaded}
              onChange={(next) => void changeViewportMode(normalizeBrowserViewportMode(next))}
              options={[
                { label: t("settingsPage.browserControl.viewportModeAuto"), value: "auto" },
                { label: t("settingsPage.browserControl.viewportModeCustom"), value: "custom" },
              ]}
            />
          </div>
          <div className="cy-settings-row">
            <div className="cy-settings-row__copy">
              <strong><Cookie size={16} />{t("settingsPage.browserControl.clearCookies")}</strong>
              <span>{t("settingsPage.browserControl.clearCookiesDescription")}</span>
            </div>
            <Popconfirm
              title={t("settingsPage.browserControl.confirmTitle")}
              description={t("settingsPage.browserControl.confirmDescription")}
              okText={t("settingsPage.browserControl.clearCookies")}
              cancelText={t("common.cancel")}
              onConfirm={() => void clearCookies()}
            >
              <Button danger loading={busy} disabled={!window.browserPanel}>
                {t("settingsPage.browserControl.clearCookies")}
              </Button>
            </Popconfirm>
          </div>
        </Card>
        {viewportModeFailed && <Alert className="cy-browser-control-page__status" type="error" showIcon message={t("settingsPage.saveFailed")} />}
        {status === "cleared" && <Alert className="cy-browser-control-page__status" type="success" showIcon message={t("settingsPage.browserControl.cookiesCleared")} />}
        {status === "failed" && <Alert className="cy-browser-control-page__status" type="error" showIcon message={t("settingsPage.browserControl.clearCookiesFailed")} />}
      </section>
    </div>
  );
}
