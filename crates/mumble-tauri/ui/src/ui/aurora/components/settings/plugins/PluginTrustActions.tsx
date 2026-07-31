import { allowPlugin, resetPluginTrust, revokePluginTrust } from "@core/store";
import { TrustScope } from "@core/plugins/tier1/trust";
import { Button } from "../../primitives";
import styles from "./Plugins.module.css";

export interface PluginTrustActionsProps {
  pluginName: string;
  allowed: boolean;
  denied: boolean;
}

const warn = (what: string) => (reason: unknown) => console.warn(`[plugin-trust] ${what} failed:`, reason);

/**
 * Grant, withdraw, or re-ask for a plugin's trust.
 *
 * The three grants are separate buttons rather than one control with a hidden
 * default: how long you are trusting something for is the substance of the
 * decision, so it should not be a dropdown you can skip past.
 */
export default function PluginTrustActions({ pluginName, allowed, denied }: PluginTrustActionsProps) {
  const grant = (scope: TrustScope) => () => void allowPlugin(pluginName, scope).catch(warn("allow"));

  return (
    <div className={styles.actions}>
      {allowed ? (
        <Button
          onClick={() => void revokePluginTrust(pluginName).catch(warn("revoke"))}
          title="Withdraw this plugin's permissions"
        >
          Revoke trust
        </Button>
      ) : (
        <>
          <Button variant="primary" onClick={grant(TrustScope.Server)}>
            Allow on this server
          </Button>
          <Button onClick={grant(TrustScope.Once)} title="Forgotten when the app closes">
            Allow once
          </Button>
          <Button onClick={grant(TrustScope.Global)} title="Applies on every server">
            Always allow
          </Button>
          {denied && (
            <Button
              variant="bare"
              onClick={() => void resetPluginTrust(pluginName).catch(warn("reprompt"))}
              title="Ask again the next time this plugin loads"
            >
              Ask again
            </Button>
          )}
        </>
      )}
    </div>
  );
}
