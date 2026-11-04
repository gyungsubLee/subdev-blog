import AppKit
import WebKit

struct Configuration: Decodable {
  let sourceRoot: String
  let port: Int
  let node: String

  var root: URL { URL(fileURLWithPath: sourceRoot, isDirectory: true) }
  var origin: URL { URL(string: "http://127.0.0.1:\(port)/")! }

  func contains(_ url: URL) -> Bool {
    url.scheme == "http" && url.host == "127.0.0.1" && url.port == port
  }

  func recoveryURL(for failedURL: URL?) -> URL {
    guard let failedURL else { return origin }
    if contains(failedURL) {
      // OAuth callbacks contain one-use codes. Retry by starting a new login.
      if failedURL.path == "/api/auth/callback" {
        return origin.appendingPathComponent("api/auth/github")
      }
      return failedURL
    }
    return origin
  }
}

enum LaunchError: LocalizedError {
  case message(String)

  var errorDescription: String? {
    switch self {
    case .message(let message): return message
    }
  }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate,
  WKDownloadDelegate, NSToolbarDelegate, NSUserInterfaceValidations
{
  private var window: NSWindow!
  private var webView: WKWebView!
  private var configuration: Configuration?
  private var starting = false
  private var startupID = UUID()
  private var server: Process?
  private var logHandle: FileHandle?
  private var browserLoginID: UUID?
  private var browserLoginFlow: String?
  private var retryURL: URL?
  private var showingNavigationError = false
  private var navigationObservations: [NSKeyValueObservation] = []

  func applicationDidFinishLaunching(_ notification: Notification) {
    installMenus()
    let webConfiguration = WKWebViewConfiguration()
    webConfiguration.preferences.isElementFullscreenEnabled = true
    webConfiguration.defaultWebpagePreferences.allowsContentJavaScript = true
    webConfiguration.mediaTypesRequiringUserActionForPlayback = []
    webView = WKWebView(frame: .zero, configuration: webConfiguration)
    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.allowsBackForwardNavigationGestures = true

    window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered, defer: false
    )
    window.title = "Second Brain"
    window.minSize = NSSize(width: 820, height: 560)
    window.isReleasedWhenClosed = false
    window.contentView = webView
    if !window.setFrameUsingName("Second BrainMainWindow") { window.center() }
    window.setFrameAutosaveName("Second BrainMainWindow")
    let toolbar = NSToolbar(identifier: "SecondBrainNavigation")
    toolbar.delegate = self
    toolbar.displayMode = .iconOnly
    window.toolbar = toolbar
    navigationObservations = [
      webView.observe(\.canGoBack) { [weak self] _, _ in
        self?.window.toolbar?.validateVisibleItems()
      },
      webView.observe(\.canGoForward) { [weak self] _, _ in
        self?.window.toolbar?.validateVisibleItems()
      },
    ]
    window.makeKeyAndOrderFront(nil)
    NSApp.activate()
    startLibrary()
  }

  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
    window.makeKeyAndOrderFront(nil)
    return true
  }

  private func installMenus() {
    let menu = NSMenu()
    let appMenu = NSMenu()
    appMenu.addItem(
      withTitle: "Second Brain 정보", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)),
      keyEquivalent: "")
    appMenu.addItem(.separator())
    appMenu.addItem(
      withTitle: "Second Brain 가리기", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
    let hideOthers = appMenu.addItem(
      withTitle: "다른 앱 가리기", action: #selector(NSApplication.hideOtherApplications(_:)),
      keyEquivalent: "h")
    hideOthers.keyEquivalentModifierMask = [.command, .option]
    appMenu.addItem(
      withTitle: "모두 보기", action: #selector(NSApplication.unhideAllApplications(_:)),
      keyEquivalent: "")
    appMenu.addItem(.separator())
    appMenu.addItem(
      withTitle: "Second Brain 끝내기", action: #selector(NSApplication.terminate(_:)),
      keyEquivalent: "q")
    menu.addItem(withTitle: "Second Brain", action: nil, keyEquivalent: "").submenu = appMenu

    let fileMenu = NSMenu(title: "파일")
    fileMenu.addItem(
      withTitle: "창 닫기", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
    menu.addItem(withTitle: "파일", action: nil, keyEquivalent: "").submenu = fileMenu

    let editMenu = NSMenu(title: "편집")
    editMenu.addItem(withTitle: "실행 취소", action: NSSelectorFromString("undo:"), keyEquivalent: "z")
    let redo = editMenu.addItem(
      withTitle: "다시 실행", action: NSSelectorFromString("redo:"), keyEquivalent: "z")
    redo.keyEquivalentModifierMask = [.command, .shift]
    editMenu.addItem(.separator())
    editMenu.addItem(withTitle: "오려두기", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    editMenu.addItem(withTitle: "복사", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    editMenu.addItem(withTitle: "붙여넣기", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    editMenu.addItem(
      withTitle: "모두 선택", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
    menu.addItem(withTitle: "편집", action: nil, keyEquivalent: "").submenu = editMenu

    let viewMenu = NSMenu(title: "보기")
    let back = viewMenu.addItem(
      withTitle: "뒤로", action: #selector(goBack(_:)), keyEquivalent: "[")
    back.target = self
    let forward = viewMenu.addItem(
      withTitle: "앞으로", action: #selector(goForward(_:)), keyEquivalent: "]")
    forward.target = self
    let home = viewMenu.addItem(
      withTitle: "홈", action: #selector(openHome(_:)), keyEquivalent: "h")
    home.target = self
    home.keyEquivalentModifierMask = [.command, .shift]
    viewMenu.addItem(.separator())
    let reload = viewMenu.addItem(
      withTitle: "새로고침", action: #selector(reloadLibrary(_:)), keyEquivalent: "r")
    reload.target = self
    menu.addItem(withTitle: "보기", action: nil, keyEquivalent: "").submenu = viewMenu

    let windowMenu = NSMenu(title: "윈도우")
    windowMenu.addItem(
      withTitle: "최소화", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
    windowMenu.addItem(
      withTitle: "확대", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
    windowMenu.addItem(
      withTitle: "모두 앞으로 가져오기", action: #selector(NSApplication.arrangeInFront(_:)),
      keyEquivalent: "")
    menu.addItem(withTitle: "윈도우", action: nil, keyEquivalent: "").submenu = windowMenu
    NSApp.mainMenu = menu
    NSApp.windowsMenu = windowMenu
  }

  func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
    toolbarDefaultItemIdentifiers(toolbar)
  }

  func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
    [.init("back"), .init("forward"), .flexibleSpace, .init("home"), .init("reload")]
  }

  func toolbar(
    _ toolbar: NSToolbar, itemForItemIdentifier identifier: NSToolbarItem.Identifier,
    willBeInsertedIntoToolbar flag: Bool
  ) -> NSToolbarItem? {
    let label: String
    let symbol: String
    let action: Selector
    switch identifier.rawValue {
    case "back":
      (label, symbol, action) = ("뒤로", "chevron.left", #selector(goBack(_:)))
    case "forward":
      (label, symbol, action) = ("앞으로", "chevron.right", #selector(goForward(_:)))
    case "home":
      (label, symbol, action) = ("홈", "house", #selector(openHome(_:)))
    case "reload":
      (label, symbol, action) = ("새로고침", "arrow.clockwise", #selector(reloadLibrary(_:)))
    default:
      return nil
    }
    let item = NSToolbarItem(itemIdentifier: identifier)
    item.label = label
    item.toolTip = label
    item.image = NSImage(systemSymbolName: symbol, accessibilityDescription: label)
    item.target = self
    item.action = action
    return item
  }

  func validateUserInterfaceItem(_ item: NSValidatedUserInterfaceItem) -> Bool {
    if item.action == #selector(goBack(_:)) { return (webView.canGoBack || browserLoginID != nil) && !starting }
    if item.action == #selector(goForward(_:)) { return webView.canGoForward && !starting }
    return !starting
  }

  @objc private func goBack(_ sender: Any?) {
    cancelBrowserLogin()
    retryURL = nil
    webView.stopLoading()
    if webView.canGoBack { webView.goBack() } else { openHome(sender) }
  }

  @objc private func goForward(_ sender: Any?) {
    cancelBrowserLogin()
    retryURL = nil
    webView.stopLoading()
    if webView.canGoForward { webView.goForward() }
  }

  @objc private func openHome(_ sender: Any?) {
    cancelBrowserLogin()
    retryURL = nil
    webView.stopLoading()
    guard server?.isRunning == true, let configuration else {
      startLibrary()
      return
    }
    webView.load(URLRequest(url: configuration.origin, timeoutInterval: 30))
  }

  @objc private func reloadLibrary(_ sender: Any?) {
    if browserLoginID != nil {
      startBrowserLogin()
      return
    }
    guard server?.isRunning == true else {
      startLibrary()
      return
    }
    if let retryURL {
      webView.load(URLRequest(url: retryURL, timeoutInterval: 30))
    } else if webView.url == nil {
      openHome(sender)
    } else {
      webView.reload()
    }
  }

  private func nativeAuthRequest(_ path: String, method: String = "GET", flow: String? = nil) -> URLRequest? {
    guard let configuration else { return nil }
    var components = URLComponents(url: configuration.origin.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
    if let flow { components.queryItems = [URLQueryItem(name: "flow", value: flow)] }
    guard let url = components.url else { return nil }
    var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 5)
    request.httpMethod = method
    request.httpShouldHandleCookies = false
    request.setValue(startupID.uuidString, forHTTPHeaderField: "X-Second-Brain-Native")
    return request
  }

  private func cancelBrowserLogin() {
    guard browserLoginID != nil else { return }
    if let flow = browserLoginFlow,
      let request = nativeAuthRequest("__native/auth/result", method: "DELETE", flow: flow) {
      URLSession.shared.dataTask(with: request).resume()
    }
    browserLoginID = nil
    browserLoginFlow = nil
    window.title = "Second Brain"
    window.toolbar?.validateVisibleItems()
  }

  private func startBrowserLogin() {
    cancelBrowserLogin()
    guard let request = nativeAuthRequest("__native/auth/start", method: "POST") else { return }
    let attempt = UUID()
    browserLoginID = attempt
    window.title = "Second Brain — 브라우저 로그인 중"
    window.toolbar?.validateVisibleItems()
    URLSession.shared.dataTask(with: request) { data, response, _ in
      DispatchQueue.main.async {
        guard self.browserLoginID == attempt else { return }
        guard let response = response as? HTTPURLResponse, response.statusCode == 200,
          let data, let state = try? JSONSerialization.jsonObject(with: data) as? [String: String],
          let flow = state["flow"], let address = state["url"], let url = URL(string: address),
          self.configuration?.contains(url) == true, url.path == "/__native/auth/login"
        else {
          self.failBrowserLogin(attempt, message: "브라우저 로그인을 시작하지 못했습니다. 다시 시도해 주세요.")
          return
        }
        self.browserLoginFlow = flow
        guard NSWorkspace.shared.open(url) else {
          self.failBrowserLogin(attempt, message: "기본 브라우저를 열지 못했습니다. 다시 시도해 주세요.")
          return
        }
        self.pollBrowserLogin(attempt, flow: flow, deadline: Date().addingTimeInterval(600))
      }
    }.resume()
  }

  private func failBrowserLogin(_ attempt: UUID, message: String) {
    guard browserLoginID == attempt else { return }
    cancelBrowserLogin()
    showNavigationFailure(message, failedURL: configuration?.origin.appendingPathComponent("api/auth/github"))
  }

  private func pollBrowserLogin(_ attempt: UUID, flow: String, deadline: Date) {
    guard browserLoginID == attempt,
      let request = nativeAuthRequest("__native/auth/result", flow: flow) else { return }
    URLSession.shared.dataTask(with: request) { data, response, _ in
      DispatchQueue.main.async {
        guard self.browserLoginID == attempt else { return }
        guard let response = response as? HTTPURLResponse, let data,
          let state = try? JSONSerialization.jsonObject(with: data) as? [String: String]
        else {
          self.failBrowserLogin(attempt, message: "로그인 연결이 끊겼습니다. 다시 시도해 주세요.")
          return
        }
        if response.statusCode == 202 && Date() < deadline {
          DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            self.pollBrowserLogin(attempt, flow: flow, deadline: deadline)
          }
        } else if response.statusCode == 200 && state["state"] == "complete",
          let header = response.value(forHTTPHeaderField: "Set-Cookie"), let configuration = self.configuration,
          let cookie = HTTPCookie.cookies(withResponseHeaderFields: ["Set-Cookie": header], for: configuration.origin)
            .first(where: { $0.name == "cms_session" && $0.domain == "127.0.0.1" && $0.path == "/" && $0.isHTTPOnly }) {
          self.webView.configuration.websiteDataStore.httpCookieStore.setCookie(cookie) {
            DispatchQueue.main.async {
              guard self.browserLoginID == attempt else { return }
              self.browserLoginID = nil
              self.browserLoginFlow = nil
              self.window.title = "Second Brain"
              self.openHome(nil)
              self.window.makeKeyAndOrderFront(nil)
              NSApp.activate()
            }
          }
        } else {
          self.failBrowserLogin(attempt, message: "로그인이 취소되었거나 시간이 초과됐습니다. 다시 시도하거나 홈으로 돌아가세요.")
        }
      }
    }.resume()
  }

  // The app owns only this preview process; it never reuses an unrelated listener.
  private func stopServer() {
    guard let process = server else { return }
    if process.isRunning { process.terminate() }
    server = nil
    try? logHandle?.close()
    logHandle = nil
  }

  func applicationWillTerminate(_ notification: Notification) {
    cancelBrowserLogin()
    stopServer()
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

  private func startLibrary() {
    guard !starting else { return }
    stopServer()
    starting = true
    startupID = UUID()
    let attempt = startupID
    do {
      guard let url = Bundle.main.url(forResource: "config", withExtension: "json") else {
        throw LaunchError.message("Missing app configuration. Rebuild with app/native/build.py.")
      }
      let configuration = try JSONDecoder().decode(Configuration.self, from: Data(contentsOf: url))
      guard configuration.sourceRoot.hasPrefix("/"), (1...65535).contains(configuration.port),
        FileManager.default.isExecutableFile(atPath: configuration.node),
        FileManager.default.fileExists(atPath: configuration.root.appendingPathComponent("dist/web/build-info.json").path)
      else { throw LaunchError.message("Project or Node.js is missing. Rebuild with app/native/build.py.") }
      self.configuration = configuration
      let logs = configuration.root.appendingPathComponent(".tmp/native", isDirectory: true)
      try FileManager.default.createDirectory(at: logs, withIntermediateDirectories: true)
      let logURL = logs.appendingPathComponent("server.log")
      FileManager.default.createFile(atPath: logURL.path, contents: nil)
      logHandle = try FileHandle(forWritingTo: logURL)
      let process = Process()
      process.executableURL = URL(fileURLWithPath: configuration.node)
      process.arguments = [
        configuration.root.appendingPathComponent("node_modules/vite/bin/vite.js").path,
        "preview", "--host", "127.0.0.1", "--port", String(configuration.port), "--strictPort",
      ]
      process.currentDirectoryURL = configuration.root
      var environment = ProcessInfo.processInfo.environment
      environment["SECOND_BRAIN_NATIVE_TOKEN"] = attempt.uuidString
      process.environment = environment
      process.standardInput = FileHandle.nullDevice
      process.standardOutput = logHandle
      process.standardError = logHandle
      server = process
      try process.run()
      pollLibrary(configuration, process: process, deadline: Date().addingTimeInterval(30), attempt: attempt)
    } catch {
      finishStartup(attempt: attempt, error: error.localizedDescription)
    }
  }

  private func pollLibrary(
    _ configuration: Configuration, process: Process, deadline: Date, attempt: UUID
  ) {
    let request = URLRequest(
      url: configuration.origin.appendingPathComponent("__native/health"),
      cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 1)
    URLSession.shared.dataTask(with: request) { data, response, _ in
      DispatchQueue.main.async {
        guard self.starting && self.startupID == attempt else { return }
        if !process.isRunning {
          self.finishStartup(attempt: attempt, error: "Server exited. Check .tmp/native/server.log; port 5173 must be free.")
        } else if let response = response as? HTTPURLResponse, response.statusCode == 200,
          response.url.map(configuration.contains) == true, let data,
          let health = try? JSONSerialization.jsonObject(with: data) as? [String: String],
          health["token"] == attempt.uuidString {
          self.finishStartup(attempt: attempt, error: nil)
        } else if Date() >= deadline {
          self.finishStartup(attempt: attempt, error: "Server startup timed out. Check .tmp/native/server.log.")
        } else {
          DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            self.pollLibrary(configuration, process: process, deadline: deadline, attempt: attempt)
          }
        }
      }
    }.resume()
  }

  private func finishStartup(attempt: UUID, error: String?) {
    DispatchQueue.main.async {
      guard self.starting && self.startupID == attempt else { return }
      self.starting = false
      self.window.title = "Second Brain"
      if let error {
        self.stopServer()
        self.showStartupFailure(error)
      } else if let configuration = self.configuration {
        self.webView.load(URLRequest(url: configuration.origin))
      }
      self.window.toolbar?.validateVisibleItems()
    }
  }

  private func showStartupFailure(_ message: String) {
    let alert = NSAlert()
    alert.alertStyle = .warning
    alert.messageText = "Second Brain을 열지 못했습니다"
    alert.informativeText = message
    alert.addButton(withTitle: "다시 시도")
    alert.addButton(withTitle: "닫기")
    alert.beginSheetModal(for: window) { result in
      if result == .alertFirstButtonReturn { self.startLibrary() }
    }
  }

  private func showNavigationFailure(_ message: String, failedURL: URL?) {
    guard !showingNavigationError, let configuration else { return }
    showingNavigationError = true
    retryURL = configuration.recoveryURL(for: failedURL)
    webView.stopLoading()
    let alert = NSAlert()
    alert.alertStyle = .warning
    alert.messageText = "페이지를 열지 못했습니다"
    alert.informativeText = message
    alert.addButton(withTitle: "다시 시도")
    let back = alert.addButton(withTitle: webView.canGoBack ? "이전 화면" : "홈으로")
    back.keyEquivalent = "\u{1b}"
    alert.addButton(withTitle: "홈으로 이동")
    alert.beginSheetModal(for: window) { result in
      self.showingNavigationError = false
      if result == .alertFirstButtonReturn {
        self.reloadLibrary(nil)
      } else if result == .alertSecondButtonReturn {
        self.goBack(nil)
      } else {
        self.openHome(nil)
      }
    }
  }

  private func handleNavigationError(_ error: Error) {
    let failure = error as NSError
    guard failure.code != NSURLErrorCancelled else { return }
    let failedURL = failure.userInfo[NSURLErrorFailingURLErrorKey] as? URL
    showNavigationFailure(
      "연결을 확인한 뒤 다시 시도하거나 이전 화면으로 돌아가세요.",
      failedURL: failedURL ?? webView.url)
  }

  func webView(
    _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    guard let url = navigationAction.request.url else {
      decisionHandler(.cancel)
      return
    }
    let localBlob = url.scheme == "blob" && URL(string: String(url.absoluteString.dropFirst(5)))
      .map { configuration?.contains($0) == true } == true
    if navigationAction.shouldPerformDownload && (configuration?.contains(url) == true || localBlob) {
      decisionHandler(.download)
      return
    }
    if configuration?.contains(url) == true {
      if url.path == "/api/auth/github" && navigationAction.targetFrame?.isMainFrame != false {
        decisionHandler(.cancel)
        startBrowserLogin()
        return
      }
      if navigationAction.targetFrame == nil {
        webView.load(navigationAction.request)
        decisionHandler(.cancel)
      } else {
        decisionHandler(.allow)
      }
    } else {
      decisionHandler(.cancel)
      if url.scheme == "https" { NSWorkspace.shared.open(url) }
    }
  }

  func webView(
    _ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
    decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
  ) {
    if navigationResponse.response.url.map({
      configuration?.contains($0) == true
    }) != true {
      decisionHandler(.cancel)
      if navigationResponse.isForMainFrame {
        showNavigationFailure(
          "이 페이지는 앱 안에서 열 수 없습니다. 이전 화면으로 돌아가세요.", failedURL: nil)
      }
    } else if navigationResponse.isForMainFrame,
      let response = navigationResponse.response as? HTTPURLResponse, response.statusCode >= 400 {
      decisionHandler(.cancel)
      showNavigationFailure(
        "요청을 처리하지 못했습니다. 다시 시도하거나 이전 화면으로 돌아가세요.",
        failedURL: response.url)
    } else {
      decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }
  }

  func webView(
    _ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload
  ) { download.delegate = self }

  func webView(
    _ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload
  ) { download.delegate = self }

  func download(
    _ download: WKDownload, decideDestinationUsing response: URLResponse,
    suggestedFilename: String, completionHandler: @escaping (URL?) -> Void
  ) {
    let panel = NSSavePanel()
    panel.nameFieldStringValue = suggestedFilename
    panel.beginSheetModal(for: window) { result in
      completionHandler(result == .OK ? panel.url : nil)
    }
  }

  func webView(
    _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
    for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    if let url = navigationAction.request.url {
      if self.configuration?.contains(url) == true {
        webView.load(navigationAction.request)
      } else if url.scheme == "https" {
        NSWorkspace.shared.open(url)
      }
    }
    return nil
  }

  func webView(
    _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
    withError error: Error
  ) {
    handleNavigationError(error)
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    handleNavigationError(error)
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    if !showingNavigationError { retryURL = nil }
    window.toolbar?.validateVisibleItems()
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    showNavigationFailure(
      "페이지 표시가 중단됐습니다. 다시 시도하거나 홈으로 돌아가세요.", failedURL: webView.url)
  }
}

func renderIcon(to path: String) throws {
  let image = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: 1024, pixelsHigh: 1024,
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
    colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
  )!
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: image)
  NSColor(calibratedRed: 0.96, green: 0.957, blue: 0.93, alpha: 1).setFill()
  NSBezierPath(roundedRect: NSRect(x: 64, y: 64, width: 896, height: 896), xRadius: 190, yRadius: 190).fill()
  let title = "R" as NSString
  title.draw(at: NSPoint(x: 280, y: 130), withAttributes: [
    .font: NSFont.systemFont(ofSize: 720, weight: .bold),
    .foregroundColor: NSColor(calibratedRed: 0.79, green: 0.39, blue: 0.26, alpha: 1),
  ])
  NSGraphicsContext.restoreGraphicsState()
  try image.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: path))
}

#if !NATIVE_TESTS
if CommandLine.arguments.count == 3 && CommandLine.arguments[1] == "--render-icon" {
  try renderIcon(to: CommandLine.arguments[2])
} else {
  let app = NSApplication.shared
  let delegate = AppDelegate()
  app.setActivationPolicy(.regular)
  app.delegate = delegate
  withExtendedLifetime(delegate) { app.run() }
}

#endif
