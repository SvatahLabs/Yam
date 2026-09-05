package com.svatah.automator.core;

import com.svatah.automator.exceptions.InitializationException;
import com.svatah.automator.mappers.FlowContextMapper;
import com.svatah.automator.utils.Logging;
import io.appium.java_client.AppiumDriver;
import io.appium.java_client.android.AndroidDriver;
import org.openqa.selenium.chrome.ChromeOptions;
import org.openqa.selenium.remote.DesiredCapabilities;

import java.net.MalformedURLException;
import java.net.URL;
import java.util.List;
import java.util.concurrent.TimeUnit;

public class MobileDriver {

    private DesiredCapabilities capabilities;
    private List<String> browserOptionArgs;
    private FlowContextMapper flowContextMapper;

    public MobileDriver(DesiredCapabilities capabilities, List<String> browserOptionArgs,
            FlowContextMapper flowContextMapper) {
        this.capabilities = capabilities;
        this.browserOptionArgs = browserOptionArgs;
        this.flowContextMapper = flowContextMapper;
    }

    public AppiumDriver setupAndroidChromeDriver(String baseUrl) throws InitializationException {
        AppiumDriver driver = null;
        try {
            ChromeOptions options = new ChromeOptions();
            browserOptionArgs.forEach(options::addArguments);
            capabilities.setCapability(ChromeOptions.CAPABILITY, options);
            try {
                Logging.console("stating up android chrome driver...");
                driver = new AndroidDriver(new URL("http://localhost:4723/wd/hub"), capabilities);
                Logging.console("android driver is up...");
                driver.get(baseUrl + (baseUrl.endsWith("/") ? "" : "/"));
                driver.manage().timeouts().implicitlyWait(java.time.Duration.ofSeconds(30));
                flowContextMapper.setMainWindowHandle(driver.getWindowHandle());
                // Logging.console("selenium remote hub ip address : " +
                // System.getProperty("selenium.hub.address"));
                // Logging.console("gecko driver location : " +
                // System.getProperty("webdriver.gecko.driver"));
            } catch (MalformedURLException e) {
                System.out.println(e.getMessage());
            }
        } catch (Exception e) {
            System.out.println("Getting following exception while trying to establish android chrome web driver : "
                    + e.getMessage());
            throw new InitializationException(e.getMessage());
        }
        return driver;
    }
}
