package com.svatah.automator.client;

import com.svatah.automator.exceptions.LocatorNotFoundError;
import com.svatah.automator.mappers.InfoLevel;
import com.svatah.automator.mappers.LocatorType;
import com.svatah.automator.utils.Logging;
import io.appium.java_client.AppiumDriver;
import org.apache.commons.io.FileUtils;
import org.assertj.core.api.Assertions;
import org.openqa.selenium.*;
import org.openqa.selenium.interactions.Actions;
import org.openqa.selenium.interactions.PointerInput;
import org.openqa.selenium.interactions.Sequence;
import org.openqa.selenium.support.ui.Select;

import java.io.File;
import java.io.IOException;
import java.time.Duration;
import java.util.*;

/**
 * Created by AtulSharma on 05/01/20
 */
public class MobileClient {

    private Logging logging = new Logging(InfoLevel.INFO);

    public enum Direction {
        UP, DOWN, LEFT, RIGHT
    }

    private File screenshot;

    public MobileClient(File screenshot) {
        this.screenshot = screenshot;
    }

    public void click(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        element.click();
    }

    public void clear(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        element.clear();
    }

    public void sendKeys(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap, CharSequence... keysToSend) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        element.sendKeys(keysToSend);
    }

    public String getText(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        return element.getText();
    }

    public Point getLocation(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        return element.getLocation();
    }

    public Rectangle getRectangle(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        return element.getRect();
    }

    public Dimension getSize(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        return element.getSize();
    }

    public String getTagName(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        return element.getTagName();
    }

    public String getAttribute(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap, String name) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        return element.getAttribute(name);
    }

    public String getCssValue(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap, String propertyName) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        return element.getCssValue(propertyName);
    }

    public void executeNativeScript(AppiumDriver driver, String script, Object... args) {
        driver.executeScript(script, args);
    }

    public void executeNativeAsyncScript(AppiumDriver driver, String script, Object... args) {
        driver.executeAsyncScript(script, args);
    }

    public void executeScript(AppiumDriver driver, String script, Object... args) {
        ((JavascriptExecutor) driver).executeScript(script, args);
    }

    public void executeAsyncScript(AppiumDriver driver, String script, Object... args) {
        driver.manage().timeouts().scriptTimeout(Duration.ofSeconds(90));
        ((JavascriptExecutor) driver).executeAsyncScript(script, args);
    }

    public String getTitle(AppiumDriver driver) {
        return driver.getTitle();
    }

    public void navigate(AppiumDriver driver, String url) {
        driver.navigate().to(url);
    }

    public void navigateForward(AppiumDriver driver) {
        driver.navigate().forward();
    }

    public void navigateBack(AppiumDriver driver) {
        driver.navigate().back();
    }

    public void refreshPage(AppiumDriver driver) {
        driver.navigate().refresh();
    }

    public String getCurrentWindow(AppiumDriver driver) {
        return driver.getWindowHandle();
    }

    public void switchToChildWindow(AppiumDriver driver, String mainWindow) {
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

    public void switchTo(AppiumDriver driver, String windowName) {
        driver.switchTo().window(windowName);
    }

    public void switchToFrameByElement(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        driver.switchTo().frame(element);
    }

    public void closeOtherWindows(AppiumDriver driver, String mainWindow) {
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

    /**
     * Allows the execution of single tap on the screen, analogous to click using a
     * Mouse.
     *
     * @param driver     Appium driver instance
     * @param locatorMap details of element on which single tap will be performed
     */
    public void singleTap(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap) {
        WebElement element = findElement(driver, locatorMap);
        PointerInput finger = new PointerInput(PointerInput.Kind.TOUCH, "finger");
        Sequence tap = new Sequence(finger, 1);
        tap.addAction(finger.createPointerMove(Duration.ofMillis(0), PointerInput.Origin.viewport(),
                element.getLocation().getX() + element.getSize().getWidth() / 2,
                element.getLocation().getY() + element.getSize().getHeight() / 2));
        tap.addAction(finger.createPointerDown(PointerInput.MouseButton.LEFT.asArg()));
        tap.addAction(finger.createPointerUp(PointerInput.MouseButton.LEFT.asArg()));
        driver.perform(Collections.singletonList(tap));
    }

    /**
     * Allows the execution of double tap on the screen, analogous to double click
     * using a Mouse.
     *
     * @param driver     Appium driver instance
     * @param locatorMap details of element on which double tap will be performed
     */
    public void doubleTap(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap) {
        WebElement element = findElement(driver, locatorMap);
        PointerInput finger = new PointerInput(PointerInput.Kind.TOUCH, "finger");
        Sequence doubleTap = new Sequence(finger, 1);
        int centerX = element.getLocation().getX() + element.getSize().getWidth() / 2;
        int centerY = element.getLocation().getY() + element.getSize().getHeight() / 2;

        doubleTap.addAction(
                finger.createPointerMove(Duration.ofMillis(0), PointerInput.Origin.viewport(), centerX, centerY));
        doubleTap.addAction(finger.createPointerDown(PointerInput.MouseButton.LEFT.asArg()));
        doubleTap.addAction(finger.createPointerUp(PointerInput.MouseButton.LEFT.asArg()));
        doubleTap.addAction(finger.createPointerDown(PointerInput.MouseButton.LEFT.asArg()));
        doubleTap.addAction(finger.createPointerUp(PointerInput.MouseButton.LEFT.asArg()));

        driver.perform(Collections.singletonList(doubleTap));
    }

    /**
     * Allows the execution of flick gestures starting in a location's element.
     *
     * @param driver     Appium driver instance
     * @param locatorMap details of element from where flick gestures will start
     * @param xOffset    The x offset relative to the viewport
     * @param yOffset    The y offset relative to the viewport
     * @param speed      speed to flick, 0 = normal, 1 = fast, 2 = slow
     */
    public void flick(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap, int xOffset, int yOffset,
            int speed) {
        WebElement element = findElement(driver, locatorMap);
        PointerInput finger = new PointerInput(PointerInput.Kind.TOUCH, "finger");
        Sequence flick = new Sequence(finger, 1);
        int startX = element.getLocation().getX() + element.getSize().getWidth() / 2;
        int startY = element.getLocation().getY() + element.getSize().getHeight() / 2;

        Duration duration = Duration.ofMillis(200);
        if (speed == 1)
            duration = Duration.ofMillis(100);
        if (speed == 2)
            duration = Duration.ofMillis(500);

        flick.addAction(finger.createPointerMove(Duration.ofMillis(0), PointerInput.Origin.viewport(), startX, startY));
        flick.addAction(finger.createPointerDown(PointerInput.MouseButton.LEFT.asArg()));
        flick.addAction(
                finger.createPointerMove(duration, PointerInput.Origin.viewport(), startX + xOffset, startY + yOffset));
        flick.addAction(finger.createPointerUp(PointerInput.MouseButton.LEFT.asArg()));

        driver.perform(Collections.singletonList(flick));
    }

    public void flick(AppiumDriver driver, Direction direction) {
        Dimension size = driver.manage().window().getSize();
        int startX = size.getWidth() / 2;
        int startY = size.getHeight() / 2;
        int endX = startX;
        int endY = startY;

        switch (direction) {
            case UP:
                endY = (int) (size.getHeight() * 0.2); // Flick UP moves pointer UP (drag down-ish visually, but pointer
                                                       // moves up)
                break;
            case DOWN:
                endY = (int) (size.getHeight() * 0.8);
                break;
            case LEFT:
                endX = (int) (size.getWidth() * 0.2);
                break;
            case RIGHT:
                endX = (int) (size.getWidth() * 0.8);
                break;
        }

        PointerInput finger = new PointerInput(PointerInput.Kind.TOUCH, "finger");
        Sequence flick = new Sequence(finger, 1);
        flick.addAction(finger.createPointerMove(Duration.ofMillis(0), PointerInput.Origin.viewport(), startX, startY));
        flick.addAction(finger.createPointerDown(PointerInput.MouseButton.LEFT.asArg()));
        flick.addAction(finger.createPointerMove(Duration.ofMillis(200), PointerInput.Origin.viewport(), endX, endY));
        flick.addAction(finger.createPointerUp(PointerInput.MouseButton.LEFT.asArg()));

        driver.perform(Collections.singletonList(flick));
    }

    /**
     * A convenience method that performs click-and-hold at the location of the
     * source element,
     * moves to the location of the target element, then releases the mouse.
     *
     * @param sourceLocatorMap element identity to emulate button down at.
     * @param targetLocatorMap element identity to move to and release the mouse at.
     * @return A self reference.
     */
    public void dragAndDrop(AppiumDriver driver, Map<LocatorType, List<String>> sourceLocatorMap,
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
    public void clickAndHold(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        (new Actions(driver)).clickAndHold(element).perform();
    }

    /**
     * Releases the depressed left mouse button at the current mouse location.
     */
    public void release(AppiumDriver driver) {
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
    public void contextClick(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        (new Actions(driver)).contextClick(element).perform();
    }

    /**
     * Performs a double-click at middle of the given element. Equivalent to:
     * <i>Actions.moveToElement(element).doubleClick()</i>
     *
     * @param locatorMap Element to move to.
     */
    public void doubleClick(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        (new Actions(driver)).doubleClick(element).perform();
    }

    public void keyDown(AppiumDriver driver, CharSequence keys) {
        try {
            takeScreenshot(driver);
        } catch (IOException e) {
            logging.log(e.getMessage(), e);
            e.printStackTrace();
        }
        (new Actions(driver)).keyDown(keys).perform();
    }

    public void keyDown(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap, CharSequence keys) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        (new Actions(driver)).keyDown(element, keys).perform();
    }

    public void keyUp(AppiumDriver driver, CharSequence keys) {
        try {
            takeScreenshot(driver);
        } catch (IOException e) {
            logging.log(e.getMessage(), e);
            e.printStackTrace();
        }
        (new Actions(driver)).keyUp(keys).perform();
    }

    public void keyUp(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap, CharSequence keys) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        (new Actions(driver)).keyUp(element, keys).perform();
    }

    /**
     * Allows the execution of the gesture 'down' on the screen. It is typically the
     * first of a
     * sequence of touch gestures.
     *
     * @param x The x coordinate relative to the viewport
     * @param y The y coordinate relative to the viewport
     */
    public void down(AppiumDriver driver, int x, int y) {
        PointerInput finger = new PointerInput(PointerInput.Kind.TOUCH, "finger");
        Sequence down = new Sequence(finger, 1);
        down.addAction(finger.createPointerMove(Duration.ofMillis(0), PointerInput.Origin.viewport(), x, y));
        down.addAction(finger.createPointerDown(PointerInput.MouseButton.LEFT.asArg()));
        driver.perform(Collections.singletonList(down));
    }

    /**
     * Allows the execution of the gesture 'move' on the screen.
     *
     * @param x The x coordinate relative to the viewport
     * @param y The y coordinate relative to the viewport
     */
    public void move(AppiumDriver driver, int x, int y) {
        PointerInput finger = new PointerInput(PointerInput.Kind.TOUCH, "finger");
        Sequence move = new Sequence(finger, 1);
        move.addAction(finger.createPointerMove(Duration.ofMillis(100), PointerInput.Origin.viewport(), x, y));
        driver.perform(Collections.singletonList(move));
    }

    public void submit(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        element.submit();
    }

    public void selectByVisibleText(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap,
            String visibleText) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        new Select(element).selectByVisibleText(visibleText);
    }

    public void selectByIndex(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap, int index) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        new Select(element).selectByIndex(index);
    }

    public void selectByValue(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap, String value) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        new Select(element).selectByValue(value);
    }

    public void deselectAll(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        new Select(element).deselectAll();
    }

    public void deselectByVisibleText(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap,
            String visibleText) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        new Select(element).deselectByVisibleText(visibleText);
    }

    public void deselectByIndex(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap, int index) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        new Select(element).deselectByIndex(index);
    }

    public void deselectByValue(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap, String value) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        new Select(element).deselectByValue(value);
    }

    public boolean isMultipleSelectionSupported(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        return new Select(element).isMultiple();
    }

    public void scrollIntoView(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        ((JavascriptExecutor) driver).executeScript("arguments[0].scrollIntoView(true);", element);
    }

    public void scrollToBottom(AppiumDriver driver) {
        ((JavascriptExecutor) driver)
                .executeScript("window.scrollTo(0, document.body.scrollHeight)");
    }

    public void scrollToTop(AppiumDriver driver) {
        ((JavascriptExecutor) driver)
                .executeScript("window.scrollTo(0, 0)");
    }

    public Boolean explicitWaitForElementPresence(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap,
            int maxWaitTime) {
        for (LocatorType locatorType : locatorMap.keySet()) {
            for (String locator : locatorMap.get(locatorType)) {
                WebElement element = null;
                try {
                    element = findElement(driver, locatorType, locator, maxWaitTime);
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

    public Boolean explicitWaitForElementVisibility(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap,
            int maxWaitTime) {
        for (LocatorType locatorType : locatorMap.keySet()) {
            for (String locator : locatorMap.get(locatorType)) {
                WebElement element = null;
                try {
                    element = findElement(driver, locatorType, locator, maxWaitTime);
                } catch (Exception e) {
                    logging.log(e.getMessage());
                    e.printStackTrace();
                }
                if (element != null && element.isDisplayed())
                    return true;
            }
        }
        return false;
    }

    public void moveToElement(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap) {
        WebElement element = findElement(driver, locatorMap);
        new Actions(driver).moveToElement(element).perform();
        takeScreenshot(driver, element, screenshot);
    }

    public void moveToElementAndClick(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        new Actions(driver).moveToElement(element).click().perform();
    }

    public Boolean isDisplayed(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        return element.isDisplayed();
    }

    public Boolean isSelected(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        return element.isSelected();
    }

    public Boolean isEnabled(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap) {
        WebElement element = findElement(driver, locatorMap);
        takeScreenshot(driver, element, screenshot);
        return element.isEnabled();
    }

    public boolean isElementPresent(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap) {
        return findElements(driver, locatorMap).size() > 0;
    }

    public boolean isAlertPresent(AppiumDriver driver) {
        try {
            driver.switchTo().alert();
            return true;
        } catch (NoAlertPresentException e) {
            return false;
        }
    }

    public void acceptAlert(AppiumDriver driver) {
        Alert alert = driver.switchTo().alert();
        alert.accept();
    }

    public void dismissAlert(AppiumDriver driver) {
        Alert alert = driver.switchTo().alert();
        alert.dismiss();
    }

    public String closeAlertAndGetItsText(AppiumDriver driver, boolean acceptAlert) {
        Alert alert = driver.switchTo().alert();
        String alertText = alert.getText();
        if (acceptAlert) {
            alert.accept();
        } else {
            alert.dismiss();
        }
        return alertText;
    }

    public void assertDisplayed(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap) {
        Assertions.assertThat(isDisplayed(driver, locatorMap)).isTrue();
    }

    public void assertNotDisplayed(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap) {
        Assertions.assertThat(isDisplayed(driver, locatorMap)).isFalse();
    }

    public void assertEnabled(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap) {
        Assertions.assertThat(isEnabled(driver, locatorMap)).isTrue();
    }

    public void assertDisabled(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap) {
        Assertions.assertThat(isEnabled(driver, locatorMap)).isFalse();
    }

    public void assertSelected(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap) {
        Assertions.assertThat(isSelected(driver, locatorMap)).isTrue();
    }

    public void assertNotSelected(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap) {
        Assertions.assertThat(isSelected(driver, locatorMap)).isFalse();
    }

    public void assertMultipleSelectionSupported(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap) {
        Assertions.assertThat(isMultipleSelectionSupported(driver, locatorMap)).isTrue();
    }

    public void assertMultipleSelectionNotSupported(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap) {
        Assertions.assertThat(isMultipleSelectionSupported(driver, locatorMap)).isFalse();
    }

    public void assertElementPresent(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap) {
        Assertions.assertThat(isElementPresent(driver, locatorMap))
                .as(" unable to find locator( %s). ", locatorMap)
                .isTrue();
    }

    public void assertAlertPresent(AppiumDriver driver) {
        Assertions.assertThat(isAlertPresent(driver)).isTrue();
    }

    public void assertAlertNotPresent(AppiumDriver driver) {
        Assertions.assertThat(isAlertPresent(driver)).isFalse();
    }

    public void validateText(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap, String expectedText) {
        String actualText = getText(driver, locatorMap);
        Assertions.assertThat(actualText).isEqualTo(expectedText);
    }

    public void validateTitle(AppiumDriver driver, String title) {
        Assertions.assertThat(title).isEqualTo(getTitle(driver));
    }

    public void validateContainsText(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap,
            String expectedText) {
        String actualText = getText(driver, locatorMap);
        Assertions.assertThat(actualText).contains(expectedText);
    }

    public void validateLocation(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap, int x, int y) {
        Point expectedPoint = new Point(x, y);
        Point actualPoint = getLocation(driver, locatorMap);
        Assertions.assertThat(actualPoint).isEqualToComparingFieldByField(expectedPoint);
    }

    public void validateRectangle(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap, int x, int y, int h,
            int w) {
        Rectangle expectedRectangle = new Rectangle(x, y, h, w);
        Rectangle actualRectangle = getRectangle(driver, locatorMap);
        Assertions.assertThat(actualRectangle).isEqualToComparingFieldByField(expectedRectangle);
    }

    public void validateDimension(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap, int w, int h) {
        Dimension expectedDimension = new Dimension(w, h);
        Dimension actualDimension = getSize(driver, locatorMap);
        Assertions.assertThat(actualDimension).isEqualToComparingFieldByField(expectedDimension);
    }

    public void validateTagName(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap,
            String expectedTagName) {
        String actualTagName = getTagName(driver, locatorMap);
        Assertions.assertThat(actualTagName).isEqualTo(expectedTagName);
    }

    public void validateAttributeValue(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap,
            String attributeName, String expectedAttributeValue) {
        String actualAttributeValue = getAttribute(driver, locatorMap, attributeName);
        Assertions.assertThat(actualAttributeValue).isEqualTo(expectedAttributeValue);
    }

    public void validateCssValue(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap, String propertyValue,
            String expectedPropertyValue) {
        String actualAttributeValue = getCssValue(driver, locatorMap, propertyValue);
        Assertions.assertThat(actualAttributeValue).isEqualTo(expectedPropertyValue);
    }

    public void validateAlertText(AppiumDriver driver, boolean acceptAlert, String expectedText) {
        String actualText = closeAlertAndGetItsText(driver, acceptAlert);
        Assertions.assertThat(actualText).isEqualTo(expectedText);
    }

    public void takeScreenshot(AppiumDriver driver) throws IOException {
        takeScreenshot(driver, screenshot);
    }

    private void takeScreenshot(AppiumDriver driver, File file) throws IOException {
        if (file == null) {
            file = new File(System.getProperty("user.dir") + "/tmp/success_"
                    + System.currentTimeMillis() + ".png");
        }
        File screenshot = ((TakesScreenshot) driver).getScreenshotAs(OutputType.FILE);
        FileUtils.copyFile(screenshot, file);
    }

    private void takeScreenshot(AppiumDriver driver, WebElement element, File fullScreenShot) {
        if (screenshot != null) {
            try {
                // File file = element.getScreenshotAs(OutputType.FILE);
                // FileUtils.copyFile(file, new File(System.getProperty("user.dir") +
                // "/tmp/success_element_" + System.currentTimeMillis() + ".png"));
                // use executeScript() method and pass the arguments
                driver.executeScript("arguments[0].scrollIntoView(true);", element);
                driver.executeScript("arguments[0].style.border='2px solid green'", element);
                takeScreenshot(driver, fullScreenShot);
                driver.executeScript("arguments[0].removeAttribute('style', 'border: 2px solid green;');", element);
            } catch (IOException e) {
                logging.log(e.getMessage(), e);
                e.fillInStackTrace();
            }
        }
    }

    public WebElement findElement(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap) {
        WebElement element = null;
        for (LocatorType locatorType : locatorMap.keySet()) {
            for (String locator : locatorMap.get(locatorType)) {
                try {
                    element = findElement(driver, locatorType, locator);
                } catch (org.openqa.selenium.NoSuchElementException e) {
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

    private WebElement findElement(AppiumDriver driver, LocatorType locatorType, String locator) {
        return findElement(driver, locatorType, locator, 10);
    }

    private WebElement findElement(AppiumDriver driver, LocatorType locatorType, String locator, int maxWaitTime) {
        WebElement element = null;
        driver.manage().timeouts().implicitlyWait(Duration.ofSeconds(maxWaitTime));
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
            default:
                element = null;
                break;
        }
        return element;
    }

    public List<WebElement> findElements(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap) {
        return findElements(driver, locatorMap, 5);
    }

    public List<WebElement> findElements(AppiumDriver driver, Map<LocatorType, List<String>> locatorMap,
            int maxWaitTime) {
        List<WebElement> webElements = Collections.emptyList();
        driver.manage().timeouts().implicitlyWait(Duration.ofSeconds(maxWaitTime));
        for (LocatorType locatorType : locatorMap.keySet()) {
            for (String locator : locatorMap.get(locatorType)) {
                webElements = findElements(driver, locatorType, locator);
                if (webElements != null)
                    break;
            }
        }
        return webElements;
    }

    private List<WebElement> findElements(AppiumDriver driver, LocatorType locatorType, String locator) {
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
            default:
                webElements = Collections.emptyList();
                break;
        }
        return webElements;
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
                by = By.id(locator);
                break;
        }
        return by;
    }
}
