package com.svatah.automator;

import com.svatah.automator.containers.ReturnType;
import com.svatah.automator.mappers.LocatorType;
import com.svatah.automator.client.SeleniumClient;
import org.openqa.selenium.Cookie;
import org.openqa.selenium.WebDriver;

import java.io.File;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;

/**
 * Created by atul on 14/09/17.
 */
public class CompositeClient {

    public ReturnType<Map<String, String>> login(WebDriver driver, String email, String password) {
        Map<String, String> user = new HashMap<>();
        SeleniumClient client = new SeleniumClient(new File("test.png"));
        client.clear(driver, LocatorType.NAME, "uid");
        client.sendKeys(driver, LocatorType.NAME, "uid", email);
        try {
            Thread.sleep(5000);
        } catch (InterruptedException e) {
            e.printStackTrace();
        }
        client.click(driver, LocatorType.CSS_SELECTOR, "button.btn.btn-login");
        client.clear(driver, LocatorType.NAME, "pass");
        client.sendKeys(driver, LocatorType.NAME, "pass", password);

        try {
            Thread.sleep(5000);
        } catch (InterruptedException e) {
            e.printStackTrace();
        }
        client.click(driver, LocatorType.CSS_SELECTOR, "div.spr > button.btn.btn-login");

        Set<Cookie> cookies = driver.manage().getCookies();
        for (Cookie cookie : cookies) {
            System.out.println("key : " + cookie.getName() + ", value : " + cookie.getValue());
            user.put(cookie.getName(), cookie.getValue());
        }
        ReturnType<Map<String, String>> data = new ReturnType(user.getClass());
        data.setValue(user);
        return data;
    }
}
