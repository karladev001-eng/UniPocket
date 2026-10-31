import "./style.css";
import { client, navigation } from "./state";
import { auth, empty, heading, main, owner, showError } from "./shell";
import { loadSection, navigate } from "./router";
// Bootstrap: wire navigation, confirm the administrator, then show the current section.
navigation.go = navigate;
navigation.reload = loadSection;
void (async () => {
  heading("管理者認証を確認しています");
  try {
    await client.authenticate();
    owner.textContent = client.email;
    auth.hidden = true;
    await loadSection();
  } catch (error) {
    showError(error);
    heading("管理者認証が必要です");
    main.append(
      empty("別タブでログイン後、この画面で認証を再確認してください。"),
    );
  }
})();
