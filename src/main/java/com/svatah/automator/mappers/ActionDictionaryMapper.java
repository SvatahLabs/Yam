package com.svatah.automator.mappers;

import com.svatah.automator.core.ActionDictionary;

/**
 * Created by AtulSharma on 05/07/18
 */
public class ActionDictionaryMapper<V extends ActionMapper> {

    private static ActionDictionaryMapper<?> instance;
    private ActionDictionary<V, String> actionDictionary;

    private ActionDictionaryMapper() {
        this.actionDictionary = new ActionDictionary<>();
    }

    public static ActionDictionaryMapper getInstance() {
        if (instance == null)
            instance = new ActionDictionaryMapper();
        return instance;
    }

    public static ActionDictionaryMapper getFreshInstance() {
        instance = new ActionDictionaryMapper();
        return instance;
    }

    public void setValuesInLowerCase(V action, String... values) {
        for (String value : values)
            actionDictionary.put(action, value.toLowerCase());
    }

    public V getAction(String key) {
        key = key.toLowerCase();
        return actionDictionary.getInverseMap().get(key);
    }

    public Class<V> getActionClass(V key){
        return actionDictionary.getClassMap().get(key);
    }
}
