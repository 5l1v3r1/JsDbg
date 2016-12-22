"use strict";

var FieldSelector = (function() {
    function CheckedFields() {
        this.checkedFields = {};
    }

    CheckedFields.prototype.markEnabled = function (module, type, path) {
        var key = module + "!" + type;
        if (!(key in this.checkedFields)) {
            this.checkedFields[key] = [path];
        } else {
            var paths = this._removePath(this.checkedFields[key], path);
            paths.push(path);
            this.checkedFields[key] = paths;
        }
        this.serialize();
    }

    CheckedFields.prototype.markDisabled = function (module, type, path) {
        var key = module + "!" + type;
        if (!(key in this.checkedFields)) {
            return;
        }
        this.checkedFields[key] = this._removePath(this.checkedFields[key], path);
        this.serialize();
    }

    CheckedFields.prototype.getEnabledPaths = function (module, type) {
        var key = module + "!" + type;
        if (!(key in this.checkedFields)) {
            return [];
        } else {
            return this.checkedFields[key];
        }
    }

    CheckedFields.prototype._removePath = function(paths, path) {
        return paths.filter(function (existingPath) {
            var areEqual = existingPath.length == path.length;
            for (var i = 0; i < path.length && areEqual; ++i) {
                areEqual = path[i] == existingPath[i];
            }
            return !areEqual;
        });
    }

    CheckedFields.prototype.serialize = function() {
        window.sessionStorage.setItem('FieldSelector-CheckedFields', JSON.stringify(this.checkedFields));
    }

    CheckedFields.prototype.deserialize = function() {
        var data = window.sessionStorage.getItem('FieldSelector-CheckedFields');
        if (data) {
            this.checkedFields = JSON.parse(data);
        }
    }

    function ActiveField(rootDbgObject, renderer) {
        this.rootDbgObject = rootDbgObject;
        this.renderer = renderer;
    }

    ActiveField.prototype.shouldBeApplied = function (dbgObject) {
        return dbgObject.module == this.rootDbgObject.module && dbgObject.typename == this.rootDbgObject.typename;
    }

    ActiveField.prototype.apply = function(dbgObject, container) {
        return this.renderer(dbgObject, container);
    }

    function FieldSelectorController(updateTreeUI, container) {
        this.knownTypes = [];
        this.activeFields = [];
        this.typeListContainer = document.createElement("div");
        this.updateTreeUI = updateTreeUI;
        this.isUpdateQueued = false;
        this.checkedFields = new CheckedFields();
        this.checkedFields.deserialize();

        var that = this;
        this.activeFieldGetterListener = function() {
            that._queueUpdate();
        };

        var isHidden = window.sessionStorage.getItem("FieldSelector-HideTypes") == "true";
        var showHide = document.createElement("button");
        showHide.classList.add("small-button");
        showHide.classList.add("show-hide");
        container.appendChild(showHide);
        var updateIsHidden = function() {
            if (isHidden) {
                container.classList.add("hidden");
                showHide.textContent = "Show";
            } else {
                container.classList.remove("hidden");
                showHide.textContent = "Hide";
            }
            window.sessionStorage.setItem("FieldSelector-HideTypes", isHidden);
        }
        showHide.addEventListener("click", function() {
            isHidden = !isHidden;
            updateIsHidden();
        });
        updateIsHidden();

        var instructionText = document.createElement("div");
        instructionText.classList.add("instructions");
        container.appendChild(instructionText);
        instructionText.textContent = "To annotate the tree with additional data, use the types below to select properties to render on the tree.";


        var showAllTypes = document.createElement("button");
        showAllTypes.textContent = "Show More Types";
        showAllTypes.classList.add("small-button");
        showAllTypes.classList.add("more-types");
        container.appendChild(showAllTypes);
        showAllTypes.addEventListener("click", function () {
            that.typeListContainer.classList.toggle("show-all-types");
            showAllTypes.textContent = that.typeListContainer.classList.contains("show-all-types") ? "Show Fewer Types" : "Show More Types";
        });

        container.appendChild(this.typeListContainer);

        container.classList.add("field-selection");
    }

    FieldSelectorController.prototype.addType = function (module, typename, isBaseType) {
        for (var i = 0; i < this.knownTypes.length; ++i) {
            var knownType = this.knownTypes[i];
            if (knownType.module == module && knownType.typename == typename) {
                if (!isBaseType) {
                    // We may have rendered it as a base type before.  If so, remove the class.
                    this.typeListContainer.childNodes[i].classList.remove("base-type");
                }
                return Promise.as(false);
            }
        }

        // A type we haven't seen before.
        var newTypeContainer = document.createElement("div");
        if (isBaseType) {
            newTypeContainer.classList.add("base-type");
        }

        var that = this;
        var dbgObject = new DbgObject(module, typename, 0);
        var explorer = TypeExplorer.Create(dbgObject, {
            onFieldChange: this._onFieldChange.bind(this)
        });

        // Put it into the list, re-sort, and mirror the position in the DOM.
        var newType = {
            module: module, 
            typename: typename,
            explorer: explorer
        };
        this.knownTypes.push(newType);
        this.knownTypes.sort(function (a, b) {
            return a.typename.localeCompare(b.typename);
        });
        var index = this.knownTypes.indexOf(newType);
        if (index < this.typeListContainer.childNodes.length) {
            var nodeAfter = this.typeListContainer.childNodes[index];
            this.typeListContainer.insertBefore(newTypeContainer, nodeAfter);
        } else {
            this.typeListContainer.appendChild(newTypeContainer);
        }
        
        var that = this;
        var enabledPaths = this.checkedFields.getEnabledPaths(module, typename);
        return Promise.map(enabledPaths, function (path) { return explorer.enableField(path, /*context*/true); })
        .then(function () {
            return that._renderRootType(newType, newTypeContainer);
        });
    }

    FieldSelectorController.prototype.includeDbgObjectTypes = function(dbgObject) {
        var that = this;
        return this.addType(dbgObject.module, dbgObject.typename, /*isBaseType*/false)
        .then(function (alreadyPresent) {
            if (!alreadyPresent) {
                // The type wasn't there before.  Add the base types as well.
                return Promise.map(
                    dbgObject.baseTypes(),
                    function (dbgObject) {
                        return that.addType(dbgObject.module, dbgObject.typename, /*isBaseType*/true);
                    }
                );
            }
        })
    }

    FieldSelectorController.prototype.renderFields = function(dbgObject, container) {
        if (this.activeFields.length > 0) {
            var that = this;
            var fieldsToApply = this.activeFields.slice();

            return dbgObject.baseTypes()
            .then(function (baseTypes) {
                baseTypes.unshift(dbgObject);

                function applyRemainingFieldsAndReturnContainer() {
                    if (fieldsToApply.length == 0) {
                        return container;
                    }

                    var fieldToApply = fieldsToApply.shift();
                    for (var i = 0; i < baseTypes.length; ++i) {
                        if (fieldToApply.shouldBeApplied(baseTypes[i])) {
                            return Promise.as(fieldToApply.apply(baseTypes[i], container))
                            .then(applyRemainingFieldsAndReturnContainer);
                        }
                    }

                    return applyRemainingFieldsAndReturnContainer();
                }

                return Promise.as(applyRemainingFieldsAndReturnContainer())
            });
        } else {
            return container;
        }
    }

    FieldSelectorController.prototype._renderRootType = function(rootType, typeContainer) {
        var that = this;
        typeContainer.innerHTML = "";
        typeContainer.classList.add("type-container");
        typeContainer.classList.add("root-collapsed");

        var typeName = document.createElement("div");
        typeName.classList.add("type-name");
        typeName.appendChild(document.createTextNode(rootType.typename));
        typeName.addEventListener("click", function () {
            rootType.explorer.toggleExpansion();
            typeContainer.classList.toggle("root-collapsed");
        })
        typeContainer.appendChild(typeName);

        var typeExplorerContainer = document.createElement("div");
        typeContainer.appendChild(typeExplorerContainer);

        typeContainer.style.display = "none";
        return rootType.explorer.render(typeExplorerContainer)
        .then(function () {
            typeContainer.style.display = "";
        })
    }

    FieldSelectorController.prototype._onFieldChange = function(rootDbgObject, field, enableFieldContext) {
        var that = this;
        if (field.isEnabled) {
            field.context.renderer = this._createRenderer(field);
            this.activeFields = this.activeFields.concat([new ActiveField(rootDbgObject, field.context.renderer)]);
            field.allGetters.forEach(function (getter) {
                UserEditableFunctions.AddListener(getter, that.activeFieldGetterListener);
            });
            this.checkedFields.markEnabled(rootDbgObject.module, rootDbgObject.typeDescription(), field.path);

            // When we're explicitly enabling a field we don't need to queue an update
            // because the request came from adding the type.
            if (enableFieldContext !== true) {
                this._queueUpdate();
            }
        } else if (field.context.renderer) {
            this.activeFields = this.activeFields.filter(function (af) { return af.renderer != field.context.renderer; });
            field.context.renderer = null;
            field.allGetters.forEach(function (getter) {
                UserEditableFunctions.RemoveListener(getter, that.activeFieldGetterListener);
            });
            this.checkedFields.markDisabled(rootDbgObject.module, rootDbgObject.typeDescription(), field.path);
            this._queueUpdate();
        }
    }

    function getDescs(obj) {
        return Promise.as()
        .then(function() {
            if (obj instanceof DbgObject) {
                if (obj.isNull()) {
                    return undefined;
                } else {
                    return DbgObjectInspector.Inspect(obj, obj.ptr());
                }
            } else if (Array.isArray(obj)) {
                if (obj.length == 0) {
                    return undefined;
                } else {
                    return Promise.map(obj, getDescs)
                    .then(function (array) {
                        return "[" + array.join(", ").toString() + "]";
                    });
                }
            } else {
                return obj;
            }
        });
    }

    FieldSelectorController.prototype._createRenderer = function(field) {
        function insertFieldList(names, container) {
            var fieldList = document.createElement("span");
            container.appendChild(fieldList);
            fieldList.textContent = names.join(".") + ":";
        }

        return function (dbgObject, element) {
            return Promise.as(null)
            .then(function() {
                var valueContainer = document.createElement("span");
                return DbgObject.render(
                    field.getter(dbgObject), 
                    valueContainer, 
                    function (dbgObject) {
                        if (dbgObject.isArray()) {
                            return dbgObject.array();
                        } else {
                            return dbgObject.desc().then(function (desc) {
                                return DbgObjectInspector.Inspect(dbgObject, desc);
                            })
                        }
                    },
                    element
                )
                .then(function (didRenderSomething) {
                    if (didRenderSomething) {
                        var fieldAndValue = document.createElement("span");
                        insertFieldList(field.names, fieldAndValue);
                        fieldAndValue.appendChild(valueContainer);
                        element.appendChild(fieldAndValue);
                    }
                })
            });
        }
    }

    FieldSelectorController.prototype._queueUpdate = function() {
        if (this.isUpdateQueued) {
            return;
        } else {
            this.isUpdateQueued = true;
            var that = this;
            window.requestAnimationFrame(function() {
                that.updateTreeUI();
                that.isUpdateQueued = false;
            })
        }
    }

    return {
        Create: function(updateUI, container) {
            return new FieldSelectorController(updateUI, container);
        }
    };
})();