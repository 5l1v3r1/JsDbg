"use strict";

var TSFTextStore = undefined;
Loader.OnLoad(function() {
    TSFTextStore = {
        Tree: new DbgObjectTree.DbgObjectTreeReader(),
        Renderer: new DbgObjectTree.DbgObjectRenderer(),
        InterpretAddress: function(address) {
            var voidObj = DbgObject.create("ntdll!void", address);
            if (!voidObj.isNull()) {
                return voidObj.dcast(DbgObjectType("ui_base_ime", "ui::TSFTextStore"))
                .then((tsfTextStore) => {
                    if (!tsfTextStore.isNull()) {
                        return tsfTextStore;
                    } else {
                        return DbgObject.NULL;
                    }
                });
            }
            return DbgObject.NULL;
        },
        GetRoots: function() {
            return Promise.all([DbgObject.global("ui_base_ime", "tsf_bridge_tls").F("Object").f("slot_").pointerValue(), DbgObject.teb(), DbgObject.global("base", "g_native_tls_key").val()])
            .thenAll((bigIntForSlotNumber, teb, tlsKey) => {
                return Promise.all([Promise.map(teb.array("TLS Slots"), (slotPtr) => slotPtr.deref()), Promise.resolve(bigIntForSlotNumber.valueOf())])
                .thenAll((tlsSlotsArray, slotNumber) => {
                    var tlsVectorEntry = tlsSlotsArray[tlsKey];
                    if (!tlsVectorEntry.isNull()) {
                        var invalidSlotValue = -1; // ?
                        var maxThreadLocalStorageSize = 256; // ?
                        if ((slotNumber < maxThreadLocalStorageSize) && (slotNumber != invalidSlotValue)) {
                            return tlsVectorEntry.as("void*").idx(slotNumber * 2).deref()  // ?
                            .then((tlsVectorEntryData) => {
                                var tsfBridgeImpl = tlsVectorEntryData.as(DbgObjectType("ui_base_ime", "ui::`anonymous namespace'::TSFBridgeImpl"));
                                return Promise.all([tsfBridgeImpl.f("client_").desc("textInputType_"), tsfBridgeImpl.f("tsf_document_map_")])
                                .thenAll((activeTextInputType, tsfDocumentMap) => {
                                    return Promise.filter(tsfDocumentMap.array("Pairs"), (pair) => {
                                        return pair.f("first").val()
                                        .then((textInputType) => (textInputType == activeTextInputType));
                                    })
                                    .then((activePair) => {
                                        if (activePair.length == 0) {
                                            return DbgObject.constantValue(DbgObjectType("ui_base_ime", "ui::TextInputType"), "TEXT_INPUT_TYPE_TEXT")
                                            .then((textInputTypeText) => {
                                                return Promise.filter(tsfDocumentMap.array("Pairs"), (pair) => {
                                                    return pair.f("first").val()
                                                    .then((textInputType) => (textInputType == textInputTypeText));
                                                });
                                            })
                                            .then((activePair) => activePair[0].f("second"))
                                            .then((tsfDocument) => Promise.all([tsfDocument.f("text_store.ptr_")]))
                                        } else {
                                            return activePair[0].f("second")
                                            .then((tsfDocument) => Promise.all([tsfDocument.f("text_store.ptr_")]))
                                        }
                                    });
                                });
                            });
                        } else {
                            return Promise.resolve([]);
                        }
                    }
                });
            });
        },
        DefaultTypes: [DbgObjectType("ui_base_ime", "ui::TSFTextStore")]
    };

    TSFTextStore.Tree.addChildren(DbgObjectType("ui_base_ime", "ui::TSFTextStore"), (tsfTextStore) => {
        return Promise.all([
            {
                toString : () => {
                    return "Selection";
                },
                getChildren : () => {
                    return Promise.all([tsfTextStore.f("selection_").desc()]);
                }
            },
            {
                toString : () => {
                    return "String Buffer";
                },
                getChildren : () => {
                    return Promise.all([tsfTextStore.f("string_buffer_document_").desc()]);
                }
            },
            {
                toString : () => {
                    return "Composition Range";
                },
                getChildren : () => {
                    return Promise.all([tsfTextStore.f("composition_range_").desc()]);
                }
            }
        ]);
    });

    DbgObject.AddTypeDescription(DbgObjectType("ui_base_ime", "ui::TextInputClient"), "textInputType_", false, UserEditableFunctions.Create((textInputClient) => {
        return Promise.all([textInputClient.dcast(DbgObjectType("chrome", "RemoteTextInputClient")),
            textInputClient.dcast(DbgObjectType("content", "content::RenderWidgetHostViewAura")),
            textInputClient.dcast(DbgObjectType("views", "views::PrefixSelector")),
            textInputClient.dcast(DbgObjectType("views", "views::Textfield"))])
        .thenAll((remoteTextInputClient, renderWidgetHostViewAura, prefixSelector, textField) => {
            if (!remoteTextInputClient.isNull()) {
                return remoteTextInputClient.f("text_input_type_");
            } else if (!renderWidgetHostViewAura.isNull()) {
                return Promise.all([DbgObject.create(DbgObjectType("content", "content::RenderWidgetHostViewBase"), 0).size(), DbgObject.create(DbgObjectType("content", "content::RenderWidgetHostViewEventHandler::Delegate"), 0).size(), DbgObject.create(DbgObjectType("content", "content::TextInputManager::Observer"), 0).size(), DbgObject.create(DbgObjectType("content", "void*"), 0).size()])
                .thenAll((base, delegate, observer, pointerSize) => {
                    var offset = base + delegate + observer;
                    return renderWidgetHostViewAura.as("void*").idx(-1 * offset / pointerSize)  // TODO: Fix this hack in favor of properly handling multiple inheritance.
                    .then((offsettedPtr) => {
                        renderWidgetHostViewAura = offsettedPtr.as(DbgObjectType("content", "content::RenderWidgetHostViewAura"));
                        return renderWidgetHostViewAura.f("text_input_manager_")
                        .then((textInputManager) => {
                            if (!textInputManager.isNull()) {
                                return Promise.all([textInputManager.f("active_view_"), textInputManager.f("text_input_state_map_")])
                                .thenAll((activeView, textInputStateMap) => {
                                    return Promise.filter(textInputStateMap.array("Pairs"), (pair) => {
                                        return pair.f("first")
                                        .then((view) => view.equals(activeView));
                                    });
                                })
                                .then((activeViewPair) => {
                                    return activeViewPair[0].f("second");
                                })
                                .then((textInputState) => textInputState.f("type").val());
                            } else {
                                return DbgObject.constantValue(DbgObjectType("ui_base_ime", "ui::TextInputType"), "TEXT_INPUT_TYPE_NONE");
                            }
                        });
                    });
                })
            } else if (!prefixSelector.isNull()) {
                return DbgObject.constantValue(DbgObjectType("ui_base_ime", "ui::TextInputType"), "TEXT_INPUT_TYPE_TEXT");
            } else {
                console.assert(!textField.isNull());
                return Promise.all([textField.f("read_only_").val(), textField.f("enabled_").val()])
                .thenAll((readOnly, enabled) => {
                    if (readOnly || !enabled) {
                        return DbgObject.constantValue(DbgObjectType("ui_base_ime", "ui::TextInputType"), "TEXT_INPUT_TYPE_NONE");
                    } else {
                        return textField.f("text_input_type_")
                    }
                });
            }
        })
    }));

    // TreeExtensionTemplate.Renderer.addNameRenderer(DbgObjectType("ntdll!void"), (voidObj) => {
    //     return "Type name to render";
    // });

    // DbgObject.AddAction(DbgObjectType("ntdll!void"), "TreeExtensionTemplate", (voidObj) => {
    //     return TreeInspector.GetActions("treeExtensionTemplate", "TreeExtensionTemplate", voidObj);
    // });
});