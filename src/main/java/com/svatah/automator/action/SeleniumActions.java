package com.svatah.automator.action;

import com.svatah.automator.client.SeleniumClient;
import com.svatah.automator.containers.ReturnType;
import com.svatah.automator.containers.SeleniumStepData;
import com.svatah.automator.exceptions.InvalidStepDataException;
import com.svatah.automator.mappers.FlowContextMapper;
import com.svatah.automator.mappers.SeleniumActionMapper;
import com.svatah.automator.utils.Logging;
import org.openqa.selenium.WebDriver;

import java.io.File;
import java.io.IOException;
import java.util.concurrent.TimeUnit;

/**
 * Created by atul on 12/09/17.
 */
public class SeleniumActions implements Action<WebDriver, SeleniumActionMapper, SeleniumStepData> {

    private File screenshot;
    private FlowContextMapper flowContextMapper;

    public SeleniumActions(File screenshot, FlowContextMapper flowContextMapper) {
        this.flowContextMapper = flowContextMapper;
        this.screenshot = screenshot;
    }

    @Override
    public ReturnType<String> perform(WebDriver driver, SeleniumActionMapper action, SeleniumStepData seleniumStepData) throws InvalidStepDataException {
        SeleniumClient client = new SeleniumClient(screenshot);
        ReturnType<String> returnType = null;
        switch (action.getAction()) {
            case "navigate":
                if (seleniumStepData.getInputData().getInputDataList().size() == 1)
                    client.navigate(driver, seleniumStepData.getInputData().getInputDataList().get(0));
                else
                    throw new InvalidStepDataException("Invalid step input data : expected one url string to be navigated.");
                break;
            case "forward":
                client.navigateForward(driver);
                break;
            case "back":
                client.navigateBack(driver);
                break;
            case "refresh":
                client.refreshPage(driver);
                break;
            case "switchToChildWindow":
                client.switchToChildWindow(driver, flowContextMapper.getMainWindowHandle());
                break;
            case "switchToMainWindow":
                client.switchTo(driver, flowContextMapper.getMainWindowHandle());
                break;
            case "closeOtherWindows":
                client.closeOtherWindows(driver, flowContextMapper.getMainWindowHandle());
                break;
            case "switchToFrame":
                client.switchToFrameByElement(driver, seleniumStepData.getInputData().get().getTypeAndLocatorMap());
                break;
            case "click":
                client.click(driver, seleniumStepData.getInputData().get().getTypeAndLocatorMap());
                break;
            case "clickAndHold":
                client.clickAndHold(driver, seleniumStepData.getInputData().get().getTypeAndLocatorMap());
                break;
            case "release":
                client.release(driver);
                break;
            case "doubleClick":
                client.doubleClick(driver, seleniumStepData.getInputData().get().getTypeAndLocatorMap());
                break;
            case "contextClick":
                client.contextClick(driver, seleniumStepData.getInputData().get().getTypeAndLocatorMap());
                break;
            case "clear":
                client.clear(driver, seleniumStepData.getInputData().get().getTypeAndLocatorMap());
                break;
            case "getText":
                returnType = new ReturnType<>(String.class);
                returnType.setValue(client.getText(driver, seleniumStepData.getInputData().get().getTypeAndLocatorMap()));
                break;
            case "type":
                if (seleniumStepData.getInputData().getInputDataList() == null)
                    client.sendKeys(driver, seleniumStepData.getInputData().get().getTypeAndLocatorMap());
                else
                    client.sendKeys(driver, seleniumStepData.getInputData().get().getTypeAndLocatorMap(), (String[]) seleniumStepData.getInputData().getInputDataList().toArray(new String[seleniumStepData.getInputData().getInputDataList().size()]));
                break;
            case "keyDown":
                if (seleniumStepData.getInputData().getInputDataList().size() == 1) {
                    if (seleniumStepData.getInputData().get().getTypeAndLocatorMap() == null)
                        client.keyDown(driver, seleniumStepData.getInputData().getInputDataList().get(0));
                    else
                        client.keyDown(driver, seleniumStepData.getInputData().get().getTypeAndLocatorMap(), seleniumStepData.getInputData().getInputDataList().get(0));
                }
                else
                    throw new InvalidStepDataException("Invalid step input data : expected 1 char sequence");
                break;
            case "keyUp":
                if (seleniumStepData.getInputData().getInputDataList().size() == 1) {
                    if (seleniumStepData.getInputData().get().getTypeAndLocatorMap() == null)
                        client.keyUp(driver, seleniumStepData.getInputData().getInputDataList().get(0));
                    else
                        client.keyUp(driver, seleniumStepData.getInputData().get().getTypeAndLocatorMap(), seleniumStepData.getInputData().getInputDataList().get(0));
                }
                else
                    throw new InvalidStepDataException("Invalid step input data : expected 1 char sequence");
                break;
            case "submit":
                client.submit(driver, seleniumStepData.getInputData().get().getTypeAndLocatorMap());
                break;
            case "moveToElement":
                client.moveToElement(driver, seleniumStepData.getInputData().get().getTypeAndLocatorMap());
                break;
            case "moveToElementAndClick":
                client.moveToElementAndClick(driver, seleniumStepData.getInputData().get().getTypeAndLocatorMap());
                break;
            case "dismissAlert":
                if (client.isAlertPresent(driver))
                    client.dismissAlert(driver);
                else {
                    Logging.console("Unable to find any alert.");
                }
                break;
            case "acceptAlert":
                if (client.isAlertPresent(driver))
                    client.acceptAlert(driver);
                else {
                    Logging.console("Unable to find any alert.");
                }
                break;
            case "wait":
                long time;
                try {
                    if (!seleniumStepData.getInputData().getInputDataList().isEmpty()) {
                        time = Long.parseLong(seleniumStepData.getInputData().getInputDataList().get(0).replaceAll("\\s", ""));
                    } else {
                        Logging.console("No input hence using default wait time 10 seconds.");
                        time = 10;
                    }
                } catch (Exception e) {
                    e.printStackTrace();
                    Logging.console("Invalid input, using default wait time of 10 seconds.");
                    time = 10;
                }
                sleepyThread(time, TimeUnit.SECONDS);
                try {
                    client.takeScreenshot(driver);
                } catch (IOException e) {
                    e.printStackTrace();
                }
                break;
            case "assertSelected":
                client.assertSelected(driver, seleniumStepData.getInputData().get().getTypeAndLocatorMap());
                break;
            case "assertNotSelected":
                client.assertNotSelected(driver, seleniumStepData.getInputData().get().getTypeAndLocatorMap());
                break;
            case "assertDisplayed":
                client.assertDisplayed(driver, seleniumStepData.getInputData().get().getTypeAndLocatorMap());
                break;
            case "assertNotDisplayed":
                client.assertNotDisplayed(driver, seleniumStepData.getInputData().get().getTypeAndLocatorMap());
                break;
            case "assertEnabled":
                client.assertEnabled(driver, seleniumStepData.getInputData().get().getTypeAndLocatorMap());
                break;
            case "assertDisabled":
                client.assertDisabled(driver, seleniumStepData.getInputData().get().getTypeAndLocatorMap());
                break;
            case "assertElementPresent":
                client.assertElementPresent(driver, seleniumStepData.getInputData().get().getTypeAndLocatorMap());
                break;
            case "assertAlertPresent":
                client.assertAlertPresent(driver);
                break;
            case "assertAlertNotPresent":
                client.assertAlertNotPresent(driver);
                break;
            case "validateTitle":
                if (seleniumStepData.getInputData().getInputDataList().size() == 1)
                    client.validateTitle(driver, seleniumStepData.getInputData().getInputDataList().get(0));
                else
                    throw new InvalidStepDataException("Invalid step input data : expected a title string to be validated.");
                break;
            case "validateText":
                if (seleniumStepData.getInputData().getInputDataList().size() == 1)
                    client.validateText(driver, seleniumStepData.getInputData().get().getTypeAndLocatorMap(), seleniumStepData.getInputData().getInputDataList().get(0));
                else
                    throw new InvalidStepDataException("Invalid step input data : expected a text single string to be validated.");
                break;
            case "validateContainsText":
                if (seleniumStepData.getInputData().getInputDataList().size() == 1)
                    client.validateContainsText(driver, seleniumStepData.getInputData().get().getTypeAndLocatorMap(), seleniumStepData.getInputData().getInputDataList().get(0));
                else
                    throw new InvalidStepDataException("Invalid step input data : expected a text single string to be validated.");
                break;
            case "validateTagName":
                if (seleniumStepData.getInputData().getInputDataList().size() == 1)
                    client.validateTagName(driver, seleniumStepData.getInputData().get().getTypeAndLocatorMap(), seleniumStepData.getInputData().getInputDataList().get(0));
                else
                    throw new InvalidStepDataException("Invalid step input data : expected a single text string to be validated.");
                break;
            case "validateAttributeValue":
                if (seleniumStepData.getInputData().getInputDataList().size() == 2)
                    client.validateAttributeValue(driver, seleniumStepData.getInputData().get().getTypeAndLocatorMap(), seleniumStepData.getInputData().getInputDataList().get(0), seleniumStepData.getInputData().getInputDataList().get(1));
                else
                    throw new InvalidStepDataException("Invalid step input data : expected 2 strings, 1. attribute name, and 2. expected attribute value.");
                break;
            case "validateCssValue":
                if (seleniumStepData.getInputData().getInputDataList().size() == 2)
                    client.validateCssValue(driver, seleniumStepData.getInputData().get().getTypeAndLocatorMap(), seleniumStepData.getInputData().getInputDataList().get(0), seleniumStepData.getInputData().getInputDataList().get(1));
                else
                    throw new InvalidStepDataException("Invalid step input data : expected 2 strings, 1. property value, and 2. expected property value.");
                break;
            case "validateLocation":
                if (seleniumStepData.getInputData().getInputDataList().size() == 2)
                    try {
                        client.validateLocation(driver, seleniumStepData.getInputData().get().getTypeAndLocatorMap(), Integer.parseInt(seleniumStepData.getInputData().getInputDataList().get(0)), Integer.parseInt(seleniumStepData.getInputData().getInputDataList().get(1)));
                    } catch (NumberFormatException e) {
                        throw new InvalidStepDataException("Invalid step input data : expected 2 integers input and not " + seleniumStepData.getInputData().getInputDataList());
                    }
                else
                    throw new InvalidStepDataException("Invalid step input data : expected 2 integers as co-ordinate.");
                break;
            case "validateDimension":
                if (seleniumStepData.getInputData().getInputDataList().size() == 2)
                    try {
                        client.validateDimension(driver, seleniumStepData.getInputData().get().getTypeAndLocatorMap(), Integer.parseInt(seleniumStepData.getInputData().getInputDataList().get(0)), Integer.parseInt(seleniumStepData.getInputData().getInputDataList().get(1)));
                    } catch (NumberFormatException e) {
                        throw new InvalidStepDataException("Invalid step input data : expected 2 integers input and not " + seleniumStepData.getInputData().getInputDataList());
                    }
                else
                    throw new InvalidStepDataException("Invalid step input data : expected 2 integers as height and width for dimension validation.");
                break;
            case "validateRectangle":
                if (seleniumStepData.getInputData().getInputDataList().size() == 4)
                    try {
                        client.validateRectangle(driver, seleniumStepData.getInputData().get().getTypeAndLocatorMap(), Integer.parseInt(seleniumStepData.getInputData().getInputDataList().get(0)),
                                Integer.parseInt(seleniumStepData.getInputData().getInputDataList().get(1)), Integer.parseInt(seleniumStepData.getInputData().getInputDataList().get(2)), Integer.parseInt(seleniumStepData.getInputData().getInputDataList().get(3)));
                    } catch (NumberFormatException e) {
                        throw new InvalidStepDataException("Invalid step input data : expected 4 integers input and not " + seleniumStepData.getInputData().getInputDataList());
                    }
                else
                    throw new InvalidStepDataException("Invalid step input data : expected 4 integers as co-ordinates (x, y) , height and width for rectangle validation.");
                break;
            case "acceptAndValidateAlertText":
                if (seleniumStepData.getInputData().getInputDataList().size() == 1)
                    client.validateAlertText(driver, true, seleniumStepData.getInputData().getInputDataList().get(0));
                else
                    throw new InvalidStepDataException("Invalid step input data : expected a text string to be validated.");
                break;
            case "rejectAndValidateAlertText":
                if (seleniumStepData.getInputData().getInputDataList().size() == 1)
                    client.validateAlertText(driver, false, seleniumStepData.getInputData().getInputDataList().get(0));
                else
                    throw new InvalidStepDataException("Invalid step input data : expected one text string to be validated.");
                break;
            case "selectByVisibleText":
                if (seleniumStepData.getInputData().getInputDataList().size() == 1)
                    client.selectByVisibleText(driver, seleniumStepData.getInputData().get().getTypeAndLocatorMap(), seleniumStepData.getInputData().getInputDataList().get(0));
                else
                    throw new InvalidStepDataException("Invalid step input data : expected one visible text for selection.");
                break;
            case "selectByIndex":
                if (seleniumStepData.getInputData().getInputDataList().size() == 1) {
                    try {
                        client.selectByIndex(driver, seleniumStepData.getInputData().get().getTypeAndLocatorMap(), Integer.parseInt(seleniumStepData.getInputData().getInputDataList().get(0)));
                    } catch (NumberFormatException nfe) {
                        throw new InvalidStepDataException("Invalid step input data : expected proper integer as index for the selection.");
                    }
                } else
                    throw new InvalidStepDataException("Invalid step input data : expected one visible text for selection.");
                break;
            case "selectByValue":
                if (seleniumStepData.getInputData().getInputDataList().size() == 1)
                    client.selectByValue(driver, seleniumStepData.getInputData().get().getTypeAndLocatorMap(), seleniumStepData.getInputData().getInputDataList().get(0));
                else
                    throw new InvalidStepDataException("Invalid step input data : expected one text denoting value for selection.");
                break;
            case "deselectAll":
                client.deselectAll(driver, seleniumStepData.getInputData().get().getTypeAndLocatorMap());
                break;
            case "deselectByVisibleText":
                if (seleniumStepData.getInputData().getInputDataList().size() == 1)
                    client.deselectByVisibleText(driver, seleniumStepData.getInputData().get().getTypeAndLocatorMap(), seleniumStepData.getInputData().getInputDataList().get(0));
                else
                    throw new InvalidStepDataException("Invalid step input data : expected one visible text for de-selection.");
                break;
            case "deselectByIndex":
                if (seleniumStepData.getInputData().getInputDataList().size() == 1) {
                    try {
                        client.deselectByIndex(driver, seleniumStepData.getInputData().get().getTypeAndLocatorMap(), Integer.parseInt(seleniumStepData.getInputData().getInputDataList().get(0)));
                    } catch (NumberFormatException nfe) {
                        throw new InvalidStepDataException("Invalid step input data : expected proper integer as index for the de-selection.");
                    }
                } else
                    throw new InvalidStepDataException("Invalid step input data : expected one integer as index for the de-selection.");
                break;
            case "deselectByValue":
                if (seleniumStepData.getInputData().getInputDataList().size() == 1)
                    client.deselectByValue(driver, seleniumStepData.getInputData().get().getTypeAndLocatorMap(), seleniumStepData.getInputData().getInputDataList().get(0));
                else
                    throw new InvalidStepDataException("Invalid step input data : expected one text denoting value for de-selection.");
                break;
            case "isMultipleSelectionSupported":
                client.isMultipleSelectionSupported(driver, seleniumStepData.getInputData().get().getTypeAndLocatorMap());
                break;
            case "assertMultipleSelectionSupported":
                client.assertMultipleSelectionSupported(driver, seleniumStepData.getInputData().get().getTypeAndLocatorMap());
                break;
            case "assertMultipleSelectionNotSupported":
                client.assertMultipleSelectionNotSupported(driver, seleniumStepData.getInputData().get().getTypeAndLocatorMap());
                break;
            case "scrollIntoView":
                client.scrollIntoView(driver, seleniumStepData.getInputData().get().getTypeAndLocatorMap());
                break;
            case "scrollToBottom":
                client.scrollToBottom(driver);
                break;
            case "scrollToTop":
                client.scrollToTop(driver);
                break;
            case "explicitWaitForElementPresence":
                boolean statusPresence;
                if (seleniumStepData.getInputData().getInputDataList().size() == 1) {
                    int maxWaitTime;
                    try {
                        maxWaitTime = Integer.parseInt(seleniumStepData.getInputData().getInputDataList().get(0));
                    } catch (NumberFormatException nfe) {
                        maxWaitTime = 30;
                    }
                    statusPresence = client.explicitWaitForElementPresence(driver, seleniumStepData.getInputData().get().getTypeAndLocatorMap(), maxWaitTime);
                } else
                    statusPresence = client.explicitWaitForElementPresence(driver, seleniumStepData.getInputData().get().getTypeAndLocatorMap(), 30);
                if (!statusPresence)
                    throw new AssertionError("Element was not present even after explicitly waiting");
                break;
            case "explicitWaitForElementVisibility":
                boolean status;
                if (seleniumStepData.getInputData().getInputDataList().size() == 1) {
                    int maxWaitTime;
                    try {
                        maxWaitTime = Integer.parseInt(seleniumStepData.getInputData().getInputDataList().get(0));
                    } catch (NumberFormatException nfe) {
                        maxWaitTime = 30;
                    }
                    status = client.explicitWaitForElementVisibility(driver, seleniumStepData.getInputData().get().getTypeAndLocatorMap(), maxWaitTime);
                } else {
                    status = client.explicitWaitForElementVisibility(driver, seleniumStepData.getInputData().get().getTypeAndLocatorMap(), 30);
                }
                if (!status)
                    throw new AssertionError("Element was not visible even after explicitly waiting");
                break;
            case "executeScript":
                if (seleniumStepData.getInputData().getInputDataList().size() == 1)
                    client.executeScript(driver, seleniumStepData.getInputData().getInputDataList().get(0));
                else
                    throw new InvalidStepDataException("Invalid step input data : expected a javascript function to be executed.");
            case "executeAsyncScript":
                if (seleniumStepData.getInputData().getInputDataList().size() == 1)
                    client.executeAsyncScript(driver, seleniumStepData.getInputData().getInputDataList().get(0));
                else
                    throw new InvalidStepDataException("Invalid step input data : expected a javascript function to be executed.");
            default:
                break;
        }
        return returnType;
    }

    private void sleepyThread(long time, TimeUnit unit) {
        try {
            Thread.sleep(TimeUnit.MILLISECONDS.convert(Math.max(0, time), unit));
        } catch (InterruptedException e) {
            e.printStackTrace();
        }
    }
}
