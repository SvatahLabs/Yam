package com.svatah.automator.core;

import com.svatah.automator.exceptions.InitializationException;
import com.svatah.automator.mappers.FlowContextMapper;
import com.svatah.automator.utils.Logging;
import io.github.bonigarcia.wdm.WebDriverManager;
import org.openqa.selenium.Dimension;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.firefox.FirefoxDriver;
import org.openqa.selenium.chrome.ChromeOptions;
import org.openqa.selenium.firefox.FirefoxOptions;
import org.openqa.selenium.remote.RemoteWebDriver;

import java.net.URL;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * Created by atul on 21/09/17.
 */
// TODO: Chrome driver is throwing exception due to :
// driver.manage().window().maximize();
public abstract class AbstractSeleniumDriver {

    private FlowContextMapper flowContextMapper;

    /****************************************************************************************
     * Constructor to setup a Selenium Driver Instance.
     *
     * @param propertyMap is set of key-value pairs which invoking class needs to
     *                    provide to
     *                    set up the system properties needed for initializing the
     *                    driver
     *                    instance. For e.g. if you need remote web driver then you
     *                    need to
     *                    provide 'selenium.hub.address' as key and 'REMOTE IP' as
     *                    the value.
     * 
     ***************************************************************************************/
    public AbstractSeleniumDriver(Map<String, String> propertyMap, FlowContextMapper flowContextMapper) {
        for (String key : propertyMap.keySet()) {
            System.setProperty(key, propertyMap.get(key));
        }
        this.flowContextMapper = flowContextMapper;
    }

    private WebDriver setUpFireFoxDriver(String baseUrl) throws InitializationException {
        WebDriver driver = null;
        try {
            WebDriverManager.firefoxdriver().setup();
            driver = new FirefoxDriver();
            driver.manage().timeouts().implicitlyWait(30, TimeUnit.SECONDS);
            if (System.getProperty("screenWidth") != null && System.getProperty("screenHeight") != null) {
                try {
                    driver.manage().window().setSize(new Dimension(Integer.parseInt(System.getProperty("screenWidth")),
                            Integer.parseInt(System.getProperty("screenHeight"))));
                } catch (NumberFormatException e) {
                    e.printStackTrace();
                }
            }
            driver.get(baseUrl + (baseUrl.endsWith("/") ? "" : "/"));
            flowContextMapper.setMainWindowHandle(driver.getWindowHandle());
        } catch (Exception e) {
            e.printStackTrace();
        } finally {
            if (driver == null) {
                Logging.console(
                        "To use firefox, you need to specify gecko-driver : System.setProperty(\"webdriver.gecko.driver\",<PATH_TO_DRIVER>);");
                throw new InitializationException(
                        "To use firefox, you need to specify gecko-driver : System.setProperty(\"webdriver.gecko.driver\",<PATH_TO_DRIVER>);");
            }
        }
        return driver;
    }

    private WebDriver setUpChromeDriver(String baseUrl) throws InitializationException {
        WebDriver driver = null;
        try {
            WebDriverManager.chromedriver().setup();
            driver = new ChromeDriver();
            driver.manage().timeouts().implicitlyWait(30, TimeUnit.SECONDS);
            if (System.getProperty("screenWidth") != null && System.getProperty("screenHeight") != null) {
                try {
                    driver.manage().window().setSize(new Dimension(Integer.parseInt(System.getProperty("screenWidth")),
                            Integer.parseInt(System.getProperty("screenHeight"))));
                } catch (NumberFormatException e) {
                    e.printStackTrace();
                }
            }
            driver.get(baseUrl + (baseUrl.endsWith("/") ? "" : "/"));
            flowContextMapper.setMainWindowHandle(driver.getWindowHandle());
        } catch (Exception e) {
            e.printStackTrace();
        } finally {
            if (driver == null) {
                Logging.console(
                        "To use chrome, you need to specify chrome-driver : System.setProperty(\"webdriver.chrome.driver\",<PATH_TO_DRIVER>);");
                throw new InitializationException(
                        "To use chrome, you need to specify chrome-driver : System.setProperty(\"webdriver.chrome.driver\",<PATH_TO_DRIVER>);");
            }
        }
        return driver;
    }

    private WebDriver setUpRemoteFireFoxDriver(String baseUrl) throws InitializationException {
        WebDriver driver = null;
        FirefoxOptions capabilities = new FirefoxOptions();
        try {
            WebDriverManager.firefoxdriver().setup();
            driver = new RemoteWebDriver(new URL(System.getProperty("selenium.hub.address")), capabilities);
            driver.manage().timeouts().implicitlyWait(30, TimeUnit.SECONDS);
            if (System.getProperty("screenWidth") != null && System.getProperty("screenHeight") != null) {
                try {
                    driver.manage().window().setSize(new Dimension(Integer.parseInt(System.getProperty("screenWidth")),
                            Integer.parseInt(System.getProperty("screenHeight"))));
                } catch (NumberFormatException e) {
                    e.printStackTrace();
                }
            }
            driver.get(baseUrl + (baseUrl.endsWith("/") ? "" : "/"));
            flowContextMapper.setMainWindowHandle(driver.getWindowHandle());
            Logging.console("selenium remote hub ip address : " + System.getProperty("selenium.hub.address"));
            // Logging.console("gecko driver location : " +
            // System.getProperty("webdriver.gecko.driver"));
        } catch (Exception e) {
            System.out.println(
                    "Getting following exception while trying to establish remote web driver : " + e.getMessage());
        } finally {
            if (driver == null) {
                Logging.console(
                        "To use firefox, you need to specify \ngecko-driver : System.setProperty(\"webdriver.gecko.driver\",<PATH_TO_DRIVER>); , \nand selenium hub ip address : System.setProperty(\"selenium.hub.address\",<SELENIUM_HUB_IP_ADDRESS>);");
                throw new InitializationException(
                        "To use firefox, you need to specify \ngecko-driver : System.setProperty(\"webdriver.gecko.driver\",<PATH_TO_DRIVER>); ,\nand selenium hub ip address : System.setProperty(\"selenium.hub.address\",<SELENIUM_HUB_IP_ADDRESS>);");
            }
        }
        return driver;
    }

    private WebDriver setUpRemoteChromeDriver(String baseUrl) throws InitializationException {
        WebDriver driver = null;
        ChromeOptions capabilities = new ChromeOptions();
        try {
            WebDriverManager.chromedriver().setup();
            driver = new RemoteWebDriver(new URL(System.getProperty("selenium.hub.address")), capabilities);
            driver.manage().timeouts().implicitlyWait(30, TimeUnit.SECONDS);
            if (System.getProperty("screenWidth") != null && System.getProperty("screenHeight") != null) {
                try {
                    driver.manage().window().setSize(new Dimension(Integer.parseInt(System.getProperty("screenWidth")),
                            Integer.parseInt(System.getProperty("screenHeight"))));
                } catch (NumberFormatException e) {
                    e.printStackTrace();
                }
            }
            driver.get(baseUrl + (baseUrl.endsWith("/") ? "" : "/"));
            flowContextMapper.setMainWindowHandle(driver.getWindowHandle());
            Logging.console("selenium remote hub ip address : " + System.getProperty("selenium.hub.address"));
        } catch (Exception e) {
            System.out.println(
                    "Getting following exception while trying to establish remote web driver : " + e.getMessage());
        } finally {
            if (driver == null) {
                Logging.console(
                        "To use remote chrome, you need to specify \nchrome-driver : System.setProperty(\"webdriver.chrome.driver\",<PATH_TO_DRIVER>); , \nand selenium hub ip address : System.setProperty(\"selenium.hub.address\",<SELENIUM_HUB_IP_ADDRESS>);");
                throw new InitializationException(
                        "To use remote chrome, you need to specify \nchrome-driver : System.setProperty(\"webdriver.chrome.driver\",<PATH_TO_DRIVER>); ,\nand selenium hub ip address : System.setProperty(\"selenium.hub.address\",<SELENIUM_HUB_IP_ADDRESS>);");
            }
        }
        return driver;
    }

    /**************************************************************
     * API for adding your custom browser support for execution
     * 
     * @param baseUrl The starting point for flows. The driver
     *                instance should open the url and then the
     *                flows will be executed from this point.
     *                This URL information comes from useBrowser
     *                method call in ExecutionController.
     ***********************************************************/
    public abstract WebDriver customBrowser(String baseUrl);

    public WebDriver useBrowser(String url, String browser) throws InitializationException {
        switch (browser.toLowerCase()) {
            case "firefox":
                return setUpFireFoxDriver(url);
            case "chrome":
                return setUpChromeDriver(url);
            case "remote-firefox":
                return setUpRemoteFireFoxDriver(url);
            case "remote-chrome":
                return setUpRemoteChromeDriver(url);
            case "custom-browser":
                return customBrowser(url);
            default:
                throw new InitializationException(
                        "Browser : " + browser + " support not found. Please implement it via custom browser.");
        }
    }
}
