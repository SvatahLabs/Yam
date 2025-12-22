package com.svatah.automator.client;

import com.svatah.automator.exceptions.LocatorNotFoundError;
import com.svatah.automator.mappers.InfoLevel;
import com.svatah.automator.mappers.LocatorType;
import com.svatah.automator.utils.Logging;
import org.apache.commons.io.FileUtils;
import org.assertj.core.api.Assertions;
import org.openqa.selenium.*;
import org.openqa.selenium.NoSuchElementException;
import org.openqa.selenium.interactions.Actions;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.Select;
import org.openqa.selenium.support.ui.WebDriverWait;

import java.io.File;
import java.io.IOException;
import java.util.*;
import java.util.concurrent.TimeUnit;

/**
 * Created by atul on 12/09/17.
 */
public class SeleniumClient {

    private Logging logging = new Logging(InfoLevel.INFO);

    private File screenshot;

    public SeleniumClient(File screenshot) {
        this.screenshot = screenshot;
    }

    /*****************************
     * Old Single Location Strategy Supporting methods
     *****************************************************/

    public void click(WebDriver driver, LocatorType locatorType, String locator) {
        WebElement element = findElement(driver, locatorType, locator);
        takeScreenshot(driver, element, screenshot);
        element.click();
    }

    public void clear(WebDriver driver, LocatorType locatorType, String locator) {
        WebElement element = findElement(driver, locatorType, locator);
        takeScreenshot(driver, element, screenshot);
        element.clear();
    }

    public String getText(WebDriver driver, LocatorType locatorType, String locator) {
        WebElement element = findElement(driver, locatorType, locator);
        takeScreenshot(driver, element, screenshot);
        return element.getText();
    }

    public Point getLocation(WebDriver driver, LocatorType locatorType, String locator) {
        WebElement element = findElement(driver, locatorType, locator);
        takeScreenshot(driver, element, screenshot);
        return element.getLocation();
    }

    public Rectangle getRectangle(WebDriver driver, LocatorType locatorType, String locator) {
        WebElement element = findElement(driver, locatorType, locator);
        takeScreenshot(driver, element, screenshot);
        return element.getRect();
    }

    public Dimension getSize(WebDriver driver, LocatorType locatorType, String locator) {
        WebElement element = findElement(driver, locatorType, locator);
        takeScreenshot(driver, element, screenshot);
        return element.getSize();
    }

    public String getTagName(WebDriver driver, LocatorType locatorType, String locator) {
        WebElement element = findElement(driver, locatorType, locator);
        takeScreenshot(driver, element, screenshot);
        return element.getTagName();
    }

    public String getAttribute(WebDriver driver, LocatorType locatorType, String locator, String name) {
        WebElement element = findElement(driver, locatorType, locator);
        takeScreenshot(driver, element, screenshot);
        return element.getAttribute(name);
    }

    public String getCssValue(WebDriver driver, LocatorType locatorType, String locator, String propertyName) {
        WebElement element = findElement(driver, locatorType, locator);
        takeScreenshot(driver, element, screenshot);
        return element.getCssValue(propertyName);
    }

    public void sendKeys(WebDriver driver, LocatorType locatorType, String locator) {
        WebElement element = findElement(driver, locatorType, locator);
        takeScreenshot(driver, element, screenshot);
        element.sendKeys();
    }

    public void sendKeys(WebDriver driver, LocatorType locatorType, String locator, CharSequence... keysToSend) {
        WebElement element = findElement(driver, locatorType, locator);
        takeScreenshot(driver, element, screenshot);
        element.sendKeys(keysToSend);
    }

    public void submit(WebDriver driver, LocatorType locatorType, String locator) {
        WebElement element = findElement(driver, locatorType, locator);
        takeScreenshot(driver, element, screenshot);
        element.submit();
    }

    public Boolean isDisplayed(WebDriver driver, LocatorType locatorType, String locator) {
        WebElement element = findElement(driver, locatorType, locator);
        takeScreenshot(driver, element, screenshot);
        return element.isDisplayed();
    }

    public Boolean isSelected(WebDriver driver, LocatorType locatorType, String locator) {
        WebElement element = findElement(driver, locatorType, locator);
        takeScreenshot(driver, element, screenshot);
        return element.isSelected();
    }

    public Boolean isEnabled(WebDriver driver, LocatorType locatorType, String locator) {
        WebElement element = findElement(driver, locatorType, locator);
        takeScreenshot(driver, element, screenshot);
        return element.isEnabled();
    }

    public boolean isElementPresent(WebDriver driver, LocatorType locatorType, String locator) {
        return findElements(driver, locatorType, locator).size() > 0;
    }

    public void assertDisplayed(WebDriver driver, LocatorType locatorType, String locator) {
        Assertions.assertThat(isDisplayed(driver, locatorType, locator)).isTrue();
    }

    public void assertNotDisplayed(WebDriver driver, LocatorType locatorType, String locator) {
        Assertions.assertThat(isDisplayed(driver, locatorType, locator)).isFalse();
    }

    public void assertEnabled(WebDriver driver, LocatorType locatorType, String locator) {
        Assertions.assertThat(isEnabled(driver, locatorType, locator)).isTrue();
    }

    public void assertDisabled(WebDriver driver, LocatorType locatorType, String locator) {
        Assertions.assertThat(isEnabled(driver, locatorType, locator)).isFalse();
    }

    public void assertSelected(WebDriver driver, LocatorType locatorType, String locator) {
        Assertions.assertThat(isSelected(driver, locatorType, locator)).isTrue();
    }

    public void assertNotSelected(WebDriver driver, LocatorType locatorType, String locator) {
        Assertions.assertThat(isSelected(driver, locatorType, locator)).isFalse();
    }

    public void assertElementPresent(WebDriver driver, LocatorType locatorType, String locator) {
        Assertions.assertThat(isElementPresent(driver, locatorType, locator))
                .as(" unable to find locator( %s, %s). ", locatorType, locator)
                .isTrue();
    }

    public void validateText(WebDriver driver, LocatorType locatorType, String locator, String expectedText) {
        String actualText = getText(driver, locatorType, locator);
        Assertions.assertThat(actualText).isEqualTo(expectedText);
    }

    public void validateLocation(WebDriver driver, LocatorType locatorType, String locator, int x, int y) {
        Point expectedPoint = new Point(x, y);
        Point actualPoint = getLocation(driver, locatorType, locator);
        Assertions.assertThat(actualPoint).isEqualToComparingFieldByField(expectedPoint);
    }

    public void validateRectangle(WebDriver driver, LocatorType locatorType, String locator, int x, int y, int h,
            int w) {
        Rectangle expectedRectangle = new Rectangle(x, y, h, w);
        Rectangle actualRectangle = getRectangle(driver, locatorType, locator);
        Assertions.assertThat(actualRectangle).isEqualToComparingFieldByField(expectedRectangle);
    }

    public void validateDimension(WebDriver driver, LocatorType locatorType, String locator, int w, int h) {
        Dimension expectedDimension = new Dimension(w, h);
        Dimension actualDimension = getSize(driver, locatorType, locator);
        Assertions.assertThat(actualDimension).isEqualToComparingFieldByField(expectedDimension);
    }

    public void validateTagName(WebDriver driver, LocatorType locatorType, String locator, String expectedTagName) {
        String actualTagName = getTagName(driver, locatorType, locator);
        Assertions.assertThat(actualTagName).isEqualTo(expectedTagName);
    }

    public void validateAttributeValue(WebDriver driver, LocatorType locatorType, String locator, String attributeName,
            String expectedAttributeValue) {
        String actualAttributeValue = getAttribute(driver, locatorType, locator, attributeName);
        Assertions.assertThat(actualAttributeValue).isEqualTo(expectedAttributeValue);
    }

    /**********************************
     * Dynamic Location Strategy Supporting methods
     *****************************************************/

    public void navigate(WebDriver driver, String url) {
        driver.navigate().to(url);
    }

    public void navigateForward(WebDriver driver) {
        driver.navigate().forward();
    }

    public void navigateBack(WebDriver driver) {
        driver.navigate().back();
    }

    public void refreshPage(WebDriver driver) {
        driver.navigate().refresh();
    }

    public String getCurrentWindow(WebDriver driver) {
        return driver.getWindowHandle();
    }

    public String getTitle(WebDriver driver) {
        return driver.getTitle();
    }

    public void switchToChildWindow(WebDriver driver, String mainWindow) {
        Set<String> set = driver.getWindowHandles();
        // Using Iterator to iterate with in windows
        Iterator<String> itr = set.iterator();
        while (itr.hasNext()) {
            String childWindow = itr.next();
            if (!mainWindow.equals(childWindow)) {
                driver.switchTo().window(childWindow);
                return;
            }
        }
    }

    public void switchTo(WebDriver driver, String windowName) {
        driver.switchTo().window(windowName);
    }

    public void switchToFrameByElement(WebDriver driver, Map<LocatorType, List<String>> locatorMap) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        driver.switchTo().frame(element);
    }

    public void closeOtherWindows(WebDriver driver, String mainWindow) {
        Set<String> set = driver.getWindowHandles();
        // Using Iterator to iterate with in windows
        Iterator<String> itr = set.iterator();
        while (itr.hasNext()) {
            String childWindow = itr.next();
            // Compare whether the main windows is not equal to child window. If not equal,
            // we will close.
            if (!mainWindow.equals(childWindow)) {
                driver.switchTo().window(childWindow);
                driver.close();
            }
        }
        // This is to switch to the main window
        driver.switchTo().window(mainWindow);
    }

    public void dragAndDrop(WebDriver driver, Map<LocatorType, List<String>> sourceLocatorMap,
            Map<LocatorType, List<String>> targetLocatorMap) {
        WebElement source = findElement(driver, sourceLocatorMap);
        WebElement target = findElement(driver, targetLocatorMap);
        takeScreenshot(driver, source, screenshot);
        (new Actions(driver)).dragAndDrop(source, target).perform();
    }

    /**
     * Clicks (without releasing) in the middle of the given element. This is
     * equivalent to:
     * <i>Actions.moveToElement(onElement).clickAndHold()</i>
     *
     * @param locatorMap Element to move to and click.
     */
    public void clickAndHold(WebDriver driver, Map<LocatorType, List<String>> locatorMap) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        (new Actions(driver)).clickAndHold(element).perform();
    }

    /**
     * Releases the depressed left mouse button at the current mouse location.
     */
    public void release(WebDriver driver) {
        try {
            takeScreenshot(driver);
        } catch (IOException e) {
            logging.log(e.getMessage(), e);
            e.printStackTrace();
        }
        (new Actions(driver)).release().perform();
    }

    /**
     * Performs a context-click at middle of the given element. First performs a
     * mouseMove
     * to the location of the element.
     *
     * @param locatorMap Element to move to.
     */
    public void contextClick(WebDriver driver, Map<LocatorType, List<String>> locatorMap) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        (new Actions(driver)).contextClick(element).perform();
    }

    public void doubleClick(WebDriver driver, Map<LocatorType, List<String>> locatorMap) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        (new Actions(driver)).doubleClick(element).perform();
    }

    public void keyDown(WebDriver driver, CharSequence keys) {
        try {
            takeScreenshot(driver);
        } catch (IOException e) {
            logging.log(e.getMessage(), e);
            e.printStackTrace();
        }
        (new Actions(driver)).keyDown(keys).perform();
    }

    public void keyDown(WebDriver driver, Map<LocatorType, List<String>> locatorMap, CharSequence keys) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        (new Actions(driver)).keyDown(element, keys).perform();
    }

    public void keyUp(WebDriver driver, CharSequence keys) {
        try {
            takeScreenshot(driver);
        } catch (IOException e) {
            logging.log(e.getMessage(), e);
            e.printStackTrace();
        }
        (new Actions(driver)).keyUp(keys).perform();
    }

    public void keyUp(WebDriver driver, Map<LocatorType, List<String>> locatorMap, CharSequence keys) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        (new Actions(driver)).keyUp(element, keys).perform();
    }

    public void click(WebDriver driver, Map<LocatorType, List<String>> locatorMap) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        element.click();
    }

    public void clear(WebDriver driver, Map<LocatorType, List<String>> locatorMap) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        element.clear();
    }

    public String getText(WebDriver driver, Map<LocatorType, List<String>> locatorMap) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        return element.getText();
    }

    public Point getLocation(WebDriver driver, Map<LocatorType, List<String>> locatorMap) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        return element.getLocation();
    }

    public Rectangle getRectangle(WebDriver driver, Map<LocatorType, List<String>> locatorMap) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        return element.getRect();
    }

    public Dimension getSize(WebDriver driver, Map<LocatorType, List<String>> locatorMap) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        return element.getSize();
    }

    public String getTagName(WebDriver driver, Map<LocatorType, List<String>> locatorMap) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        return element.getTagName();
    }

    public String getAttribute(WebDriver driver, Map<LocatorType, List<String>> locatorMap, String name) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        return element.getAttribute(name);
    }

    public String getCssValue(WebDriver driver, Map<LocatorType, List<String>> locatorMap, String propertyName) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        return element.getCssValue(propertyName);
    }

    public void sendKeys(WebDriver driver, Map<LocatorType, List<String>> locatorMap) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        element.sendKeys();
    }

    public void sendKeys(WebDriver driver, Map<LocatorType, List<String>> locatorMap, CharSequence... keysToSend) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        element.sendKeys(keysToSend);
    }

    public void submit(WebDriver driver, Map<LocatorType, List<String>> locatorMap) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        element.submit();
    }

    public void selectByVisibleText(WebDriver driver, Map<LocatorType, List<String>> locatorMap, String visibleText) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        new Select(element).selectByVisibleText(visibleText);
    }

    public void selectByIndex(WebDriver driver, Map<LocatorType, List<String>> locatorMap, int index) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        new Select(element).selectByIndex(index);
    }

    public void selectByValue(WebDriver driver, Map<LocatorType, List<String>> locatorMap, String value) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        new Select(element).selectByValue(value);
    }

    public void deselectAll(WebDriver driver, Map<LocatorType, List<String>> locatorMap) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        new Select(element).deselectAll();
    }

    public void deselectByVisibleText(WebDriver driver, Map<LocatorType, List<String>> locatorMap, String visibleText) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        new Select(element).deselectByVisibleText(visibleText);
    }

    public void deselectByIndex(WebDriver driver, Map<LocatorType, List<String>> locatorMap, int index) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        new Select(element).deselectByIndex(index);
    }

    public void deselectByValue(WebDriver driver, Map<LocatorType, List<String>> locatorMap, String value) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        new Select(element).deselectByValue(value);
    }

    public boolean isMultipleSelectionSupported(WebDriver driver, Map<LocatorType, List<String>> locatorMap) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        return new Select(element).isMultiple();
    }

    public void scrollIntoView(WebDriver driver, Map<LocatorType, List<String>> locatorMap) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        ((JavascriptExecutor) driver).executeScript("arguments[0].scrollIntoView(true);", element);
    }

    public void scrollToBottom(WebDriver driver) {
        ((JavascriptExecutor) driver)
                .executeScript("window.scrollTo(0, document.body.scrollHeight)");
    }

    public void scrollToTop(WebDriver driver) {
        ((JavascriptExecutor) driver)
                .executeScript("window.scrollTo(0, 0)");
    }

    public Boolean explicitWaitForElementPresence(WebDriver driver, Map<LocatorType, List<String>> locatorMap,
            int maxWaitTime) {
        for (LocatorType locatorType : locatorMap.keySet()) {
            for (String locator : locatorMap.get(locatorType)) {
                WebElement element = null;
                try {
                    element = new WebDriverWait(driver, java.time.Duration.ofSeconds(maxWaitTime))
                            .until(ExpectedConditions.presenceOfElementLocated(by(locatorType, locator)));
                } catch (Exception e) {
                    logging.log(e.getMessage());
                    e.printStackTrace();
                }
                if (element != null)
                    return true;
            }
        }
        return false;
    }

    public Boolean explicitWaitForElementVisibility(WebDriver driver, Map<LocatorType, List<String>> locatorMap,
            int maxWaitTime) {
        for (LocatorType locatorType : locatorMap.keySet()) {
            for (String locator : locatorMap.get(locatorType)) {
                WebElement element = null;
                try {
                    element = new WebDriverWait(driver, java.time.Duration.ofSeconds(maxWaitTime))
                            .until(ExpectedConditions.visibilityOfElementLocated(by(locatorType, locator)));
                } catch (Exception e) {
                    logging.log(e.getMessage());
                    e.printStackTrace();
                }
                if (element != null)
                    return true;
            }
        }
        return false;
    }

    public void moveToElement(WebDriver driver, Map<LocatorType, List<String>> locatorMap) {
        WebElement element = findElement(driver, locatorMap);
        new Actions(driver).moveToElement(element).perform();
        takeScreenshot(driver, element, screenshot);
    }

    public void moveToElementAndClick(WebDriver driver, Map<LocatorType, List<String>> locatorMap) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        new Actions(driver).moveToElement(element).click().perform();
    }

    public Boolean isDisplayed(WebDriver driver, Map<LocatorType, List<String>> locatorMap) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        return element.isDisplayed();
    }

    public Boolean isSelected(WebDriver driver, Map<LocatorType, List<String>> locatorMap) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        return element.isSelected();
    }

    public Boolean isEnabled(WebDriver driver, Map<LocatorType, List<String>> locatorMap) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        return element.isEnabled();
    }

    public boolean isElementPresent(WebDriver driver, Map<LocatorType, List<String>> locatorMap) {
        return findElements(driver, locatorMap).size() > 0;
    }

    public boolean isAlertPresent(WebDriver driver) {
        try {
            driver.switchTo().alert();
            return true;
        } catch (NoAlertPresentException e) {
            return false;
        }
    }

    public void acceptAlert(WebDriver driver) {
        Alert alert = driver.switchTo().alert();
        alert.accept();
    }

    public void dismissAlert(WebDriver driver) {
        Alert alert = driver.switchTo().alert();
        alert.dismiss();
    }

    public String closeAlertAndGetItsText(WebDriver driver, boolean acceptAlert) {
        Alert alert = driver.switchTo().alert();
        String alertText = alert.getText();
        if (acceptAlert) {
            alert.accept();
        } else {
            alert.dismiss();
        }
        return alertText;
    }

    public void assertDisplayed(WebDriver driver, Map<LocatorType, List<String>> locatorMap) {
        Assertions.assertThat(isDisplayed(driver, locatorMap)).isTrue();
    }

    public void assertNotDisplayed(WebDriver driver, Map<LocatorType, List<String>> locatorMap) {
        Assertions.assertThat(isDisplayed(driver, locatorMap)).isFalse();
    }

    public void assertEnabled(WebDriver driver, Map<LocatorType, List<String>> locatorMap) {
        Assertions.assertThat(isEnabled(driver, locatorMap)).isTrue();
    }

    public void assertDisabled(WebDriver driver, Map<LocatorType, List<String>> locatorMap) {
        Assertions.assertThat(isEnabled(driver, locatorMap)).isFalse();
    }

    public void assertSelected(WebDriver driver, Map<LocatorType, List<String>> locatorMap) {
        Assertions.assertThat(isSelected(driver, locatorMap)).isTrue();
    }

    public void assertNotSelected(WebDriver driver, Map<LocatorType, List<String>> locatorMap) {
        Assertions.assertThat(isSelected(driver, locatorMap)).isFalse();
    }

    public void assertMultipleSelectionSupported(WebDriver driver, Map<LocatorType, List<String>> locatorMap) {
        Assertions.assertThat(isMultipleSelectionSupported(driver, locatorMap)).isTrue();
    }

    public void assertMultipleSelectionNotSupported(WebDriver driver, Map<LocatorType, List<String>> locatorMap) {
        Assertions.assertThat(isMultipleSelectionSupported(driver, locatorMap)).isFalse();
    }

    public void assertElementPresent(WebDriver driver, Map<LocatorType, List<String>> locatorMap) {
        Assertions.assertThat(isElementPresent(driver, locatorMap))
                .as(" unable to find locator( %s). ", locatorMap)
                .isTrue();
    }

    public void assertAlertPresent(WebDriver driver) {
        Assertions.assertThat(isAlertPresent(driver)).isTrue();
    }

    public void assertAlertNotPresent(WebDriver driver) {
        Assertions.assertThat(isAlertPresent(driver)).isFalse();
    }

    public void validateText(WebDriver driver, Map<LocatorType, List<String>> locatorMap, String expectedText) {
        String actualText = getText(driver, locatorMap);
        Assertions.assertThat(actualText).isEqualTo(expectedText);
    }

    public void validateTitle(WebDriver driver, String title) {
        Assertions.assertThat(title).isEqualTo(getTitle(driver));
    }

    public void validateContainsText(WebDriver driver, Map<LocatorType, List<String>> locatorMap, String expectedText) {
        String actualText = getText(driver, locatorMap);
        Assertions.assertThat(actualText).contains(expectedText);
    }

    public void validateLocation(WebDriver driver, Map<LocatorType, List<String>> locatorMap, int x, int y) {
        Point expectedPoint = new Point(x, y);
        Point actualPoint = getLocation(driver, locatorMap);
        Assertions.assertThat(actualPoint).isEqualToComparingFieldByField(expectedPoint);
    }

    public void validateRectangle(WebDriver driver, Map<LocatorType, List<String>> locatorMap, int x, int y, int h,
            int w) {
        Rectangle expectedRectangle = new Rectangle(x, y, h, w);
        Rectangle actualRectangle = getRectangle(driver, locatorMap);
        Assertions.assertThat(actualRectangle).isEqualToComparingFieldByField(expectedRectangle);
    }

    public void validateDimension(WebDriver driver, Map<LocatorType, List<String>> locatorMap, int w, int h) {
        Dimension expectedDimension = new Dimension(w, h);
        Dimension actualDimension = getSize(driver, locatorMap);
        Assertions.assertThat(actualDimension).isEqualToComparingFieldByField(expectedDimension);
    }

    public void validateTagName(WebDriver driver, Map<LocatorType, List<String>> locatorMap, String expectedTagName) {
        String actualTagName = getTagName(driver, locatorMap);
        Assertions.assertThat(actualTagName).isEqualTo(expectedTagName);
    }

    public void validateAttributeValue(WebDriver driver, Map<LocatorType, List<String>> locatorMap,
            String attributeName, String expectedAttributeValue) {
        String actualAttributeValue = getAttribute(driver, locatorMap, attributeName);
        Assertions.assertThat(actualAttributeValue).isEqualTo(expectedAttributeValue);
    }

    public void validateCssValue(WebDriver driver, Map<LocatorType, List<String>> locatorMap, String propertyValue,
            String expectedPropertyValue) {
        String actualAttributeValue = getCssValue(driver, locatorMap, propertyValue);
        Assertions.assertThat(actualAttributeValue).isEqualTo(expectedPropertyValue);
    }

    public void validateAlertText(WebDriver driver, boolean acceptAlert, String expectedText) {
        String actualText = closeAlertAndGetItsText(driver, acceptAlert);
        Assertions.assertThat(actualText).isEqualTo(expectedText);
    }

    public void executeScript(WebDriver driver, String script, Object... args) {
        ((JavascriptExecutor) driver).executeScript(script, args);
    }

    public void executeAsyncScript(WebDriver driver, String script, Object... args) {
        ((JavascriptExecutor) driver).executeAsyncScript(script, args);
    }

    public void takeScreenshot(WebDriver driver) throws IOException {
        takeScreenshot(driver, screenshot);
    }

    private void takeScreenshot(WebDriver driver, File file) throws IOException {
        if (file == null) {
            file = new File(System.getProperty("user.dir") + "/tmp/success_" + System.currentTimeMillis() + ".png");
        }
        File screenshot = ((TakesScreenshot) driver).getScreenshotAs(OutputType.FILE);
        FileUtils.copyFile(screenshot, file);
    }

    private void takeScreenshot(WebDriver driver, WebElement element, File fullScreenShot) {
        if (screenshot != null) {
            try {
                // File file = element.getScreenshotAs(OutputType.FILE);
                // FileUtils.copyFile(file, new File(System.getProperty("user.dir") +
                // "/tmp/success_element_" + System.currentTimeMillis() + ".png"));
                JavascriptExecutor js = (JavascriptExecutor) driver;
                // use executeScript() method and pass the arguments
                js.executeScript("arguments[0].scrollIntoView(true);", element);
                js.executeScript("arguments[0].style.border='2px solid green'", element);
                takeScreenshot(driver, fullScreenShot);
                js.executeScript("arguments[0].removeAttribute('style', 'border: 2px solid green;');", element);
            } catch (IOException e) {
                logging.log(e.getMessage(), e);
                e.fillInStackTrace();
            }
        }
    }

    public WebElement findElement(WebDriver driver, Map<LocatorType, List<String>> locatorMap) {
        WebElement element = null;
        for (LocatorType locatorType : locatorMap.keySet()) {
            for (String locator : locatorMap.get(locatorType)) {
                try {
                    element = findElement(driver, locatorType, locator);
                } catch (NoSuchElementException e) {
                    e.printStackTrace();
                }
                if (element != null) {
                    break;
                }
            }
            if (element != null) {
                break;
            }
        }
        if (element == null)
            throw new LocatorNotFoundError(locatorMap,
                    "Unable to locate the element/s on page. Please verify locators");
        return element;
    }

    private WebElement findElement(WebDriver driver, LocatorType locatorType, String locator) {
        WebElement element = null;
        driver.manage().timeouts().implicitlyWait(java.time.Duration.ofSeconds(10));
        switch (locatorType.getLocatorType()) {
            case "id":
                if (driver.findElements(By.id(locator)).size() > 0)
                    element = driver.findElement(By.id(locator));
                break;
            case "name":
                if (driver.findElements(By.name(locator)).size() > 0)
                    element = driver.findElement(By.name(locator));
                break;
            case "linkText":
                if (driver.findElements(By.linkText(locator)).size() > 0)
                    element = driver.findElement(By.linkText(locator));
                break;
            case "cssSelector":
                if (driver.findElements(By.cssSelector(locator)).size() > 0)
                    element = driver.findElement(By.cssSelector(locator));
                break;
            case "xpath":
                if (driver.findElements(By.xpath(locator)).size() > 0)
                    element = driver.findElement(By.xpath(locator));
                break;
            case "className":
                if (driver.findElements(By.className(locator)).size() > 0)
                    element = driver.findElement(By.className(locator));
                break;
            case "partialLinkText":
                if (driver.findElements(By.partialLinkText(locator)).size() > 0)
                    element = driver.findElement(By.partialLinkText(locator));
                break;
            case "tagName":
                if (driver.findElements(By.tagName(locator)).size() > 0)
                    element = driver.findElement(By.tagName(locator));
                break;
            case "text":
                System.out.println("looking for locator using text = " + locator);
                if (driver.findElements(By.xpath(".//*[text()[contains(.,\"" + locator + "\")]]")).size() > 0)
                    element = driver.findElements(By.xpath(".//*[text()[contains(.,\"" + locator + "\")]]")).get(0);
                break;
            default:
                element = null;
                break;
        }
        return element;
    }

    private By by(LocatorType locatorType, String locator) {
        By by;
        switch (locatorType.getLocatorType()) {
            case "id":
                by = By.id(locator);
                break;
            case "name":
                by = By.name(locator);
                break;
            case "linkText":
                by = By.linkText(locator);
                break;
            case "cssSelector":
                by = By.cssSelector(locator);
                break;
            case "xpath":
                by = By.xpath(locator);
                break;
            case "className":
                by = By.className(locator);
                break;
            case "partialLinkText":
                by = By.partialLinkText(locator);
                break;
            case "tagName":
                by = By.tagName(locator);
                break;
            default:
                by = null;
                break;
        }
        return by;
    }

    public List<WebElement> findElements(WebDriver driver, Map<LocatorType, List<String>> locatorMap) {
        List<WebElement> webElements = Collections.emptyList();
        driver.manage().timeouts().implicitlyWait(5, TimeUnit.SECONDS);
        for (LocatorType locatorType : locatorMap.keySet()) {
            for (String locator : locatorMap.get(locatorType)) {
                webElements = findElements(driver, locatorType, locator);
                if (webElements != null)
                    break;
            }
        }
        return webElements;
    }

    private List<WebElement> findElements(WebDriver driver, LocatorType locatorType, String locator) {
        List<WebElement> webElements;
        switch (locatorType.getLocatorType()) {
            case "id":
                webElements = driver.findElements(By.id(locator));
                break;
            case "name":
                webElements = driver.findElements(By.name(locator));
                break;
            case "linkText":
                webElements = driver.findElements(By.linkText(locator));
                break;
            case "cssSelector":
                webElements = driver.findElements(By.cssSelector(locator));
                break;
            case "xpath":
                webElements = driver.findElements(By.xpath(locator));
                break;
            case "className":
                webElements = driver.findElements(By.className(locator));
                break;
            case "partialLinkText":
                webElements = driver.findElements(By.partialLinkText(locator));
                break;
            case "tagName":
                webElements = driver.findElements(By.tagName(locator));
                break;
            case "text":
                webElements = driver.findElements(By.xpath(".//*[text()[contains(.,\"" + locator + "\")]]"));
                break;
            default:
                webElements = Collections.emptyList();
                break;
        }
        return webElements;
    }
}